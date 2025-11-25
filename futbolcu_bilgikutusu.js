#!/usr/bin/env node

const { program } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;

class FutbolcuBilgiKutusuManager {
  constructor() {
    this.trWikiAPI = 'https://tr.wikipedia.org/w/api.php';
    this.config = null;
    this.cookies = '';
    this.editToken = null;
    this.userAgent = null;
    this.apiUrl = null;
    this.processedCount = 0;
    this.changedCount = 0;
    this.errorCount = 0;
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile('config.json', 'utf8');
      this.config = JSON.parse(configData);
      this.apiUrl = this.config.api_url;
      this.userAgent = this.config.user_agent;
      return true;
    } catch (error) {
      console.error('❌ Config dosyası okunamadı:', error.message);
      return false;
    }
  }

  async loadArticlesFromFile(filename) {
    try {
      const fileContent = await fs.readFile(filename, 'utf8');
      const articles = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
      
      console.log(`📋 ${filename} dosyasından ${articles.length} madde okundu`);
      return articles;
    } catch (error) {
      console.error('❌ Madde listesi dosyası okunamadı:', error.message);
      return null;
    }
  }

  getRequestConfig() {
    return {
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': this.cookies
      },
      timeout: 30000
    };
  }

  async getLoginToken() {
    const response = await axios.get(this.apiUrl, {
      params: {
        action: 'query',
        meta: 'tokens',
        type: 'login',
        format: 'json'
      },
      headers: {
        'User-Agent': this.userAgent
      },
      timeout: 15000
    });

    const setCookies = response.headers['set-cookie'];
    if (setCookies) {
      this.cookies = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
    }

    return response.data.query.tokens.logintoken;
  }

  async login() {
    const loginToken = await this.getLoginToken();
    
    const formData = new URLSearchParams();
    formData.append('action', 'login');
    formData.append('lgname', this.config.username);
    formData.append('lgpassword', this.config.password);
    formData.append('lgtoken', loginToken);
    formData.append('format', 'json');

    const response = await axios.post(this.apiUrl, formData, {
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': this.cookies,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });

    const result = response.data.login;
    if (result && result.result === 'Success') {
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        this.cookies = setCookies.map(cookie => cookie.split(';')[0]).join('; ');
      }
      return true;
    } else {
      console.error('❌ Giriş hatası:', result?.result || 'Bilinmeyen hata');
      if (result?.reason) {
        console.error('🔍 Sebep:', result.reason);
      }
      return false;
    }
  }

  async getEditToken() {
    const response = await axios.get(this.apiUrl, {
      params: {
        action: 'query',
        meta: 'tokens',
        format: 'json'
      },
      ...this.getRequestConfig()
    });

    this.editToken = response.data.query.tokens.csrftoken;
    return this.editToken;
  }

  async getPageContent(pageTitle) {
    const response = await axios.get(this.apiUrl, {
      params: {
        action: 'query',
        prop: 'revisions',
        titles: pageTitle,
        rvprop: 'content',
        rvslots: 'main',
        format: 'json'
      },
      ...this.getRequestConfig()
    });

    const pages = response.data.query.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (page.missing) return null;

    if (page.revisions && page.revisions[0] && page.revisions[0].slots.main) {
      return page.revisions[0].slots.main['*'];
    }

    return null;
  }

  async getPageCategories(pageTitle) {
    const response = await axios.get(this.apiUrl, {
      params: {
        action: 'query',
        prop: 'categories',
        titles: pageTitle,
        clshow: '!hidden',
        cllimit: 500,
        format: 'json'
      },
      ...this.getRequestConfig()
    });

    const pages = response.data.query.pages;
    const pageId = Object.keys(pages)[0];
    const page = pages[pageId];

    if (page.missing || !page.categories) return [];

    return page.categories.map(cat => cat.title.replace('Kategori:', ''));
  }

  hasFutbolcuCategory(categories) {
    // Futbolcu ile ilgili kategori desenlerini kontrol et
    const futbolcuPatterns = [
      /futbolcu/i,
    ];

    for (const category of categories) {
      for (const pattern of futbolcuPatterns) {
        if (pattern.test(category)) {
          return true;
        }
      }
    }

    return false;
  }

  async editPage(title, content, summary) {
    const formData = new URLSearchParams();
    formData.append('action', 'edit');
    formData.append('title', title);
    formData.append('text', content);
    formData.append('summary', summary);
    formData.append('token', this.editToken);
    formData.append('format', 'json');
    formData.append('bot', '1');

    const response = await axios.post(this.apiUrl, formData, {
      headers: {
        'User-Agent': this.userAgent,
        'Cookie': this.cookies,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });

    const result = response.data;
    return result.edit && result.edit.result === 'Success';
  }

  async processArticle(articleTitle) {
    try {
      console.log(`\n🔍 İşleniyor: ${articleTitle}`);
      
      // Madde içeriğini al
      const content = await this.getPageContent(articleTitle);
      if (!content) {
        console.log(`   ❌ Madde içeriği alınamadı`);
        this.errorCount++;
        return false;
      }
      
      // Maddenin kategorilerini al
      const categories = await this.getPageCategories(articleTitle);
      console.log(`   📂 ${categories.length} kategori bulundu`);
      
      // Futbolcu kategorisi kontrolü
      const isFutbolcu = this.hasFutbolcuCategory(categories);
      
      let newContent = content;
      let changesMade = false;
      let summary = '';
      
      // Sadece futbolcu ise kategoriyi değiştir
      if (isFutbolcu) {
        console.log(`   ⚽ Futbolcu kategorisi tespit edildi`);
        
        const oldCategoryPattern = /\[\[Kategori:Bilgi kutusu bulunmayan kişiler\]\]/gi;
        const newCategory = '[[Kategori:Bilgi kutusu bulunmayan futbolcular]]';
        
        if (oldCategoryPattern.test(newContent)) {
          newContent = newContent.replace(oldCategoryPattern, newCategory);
          changesMade = true;
          summary = 'Futbolcu olduğu için [[Kategori:Bilgi kutusu bulunmayan kişiler]] → [[Kategori:Bilgi kutusu bulunmayan futbolcular]] değiştirildi';
          console.log(`   🔄 Kategori futbolcular olarak değiştirildi`);
        } else {
          console.log(`   ℹ️  "Bilgi kutusu bulunmayan kişiler" kategorisi yok`);
        }
      } else {
        console.log(`   ⏭️  Futbolcu değil, atlanıyor`);
      }
      
      // Eğer değişiklik yapıldıysa kaydet
      if (changesMade && newContent !== content) {
        const success = await this.editPage(articleTitle, newContent, summary);
        
        if (success) {
          console.log(`   ✅ Değişiklikler kaydedildi`);
          this.changedCount++;
          return true;
        } else {
          console.log(`   ❌ Değişiklik kaydedilemedi`);
          this.errorCount++;
          return false;
        }
      } else {
        console.log(`   ℹ️  Değişiklik yapılmadı`);
        return false;
      }
      
    } catch (error) {
      console.error(`   ❌ Hata: ${error.message}`);
      this.errorCount++;
      return false;
    }
  }

  async processArticles(articles) {
    console.log(`\n🎯 ${articles.length} madde işlenecek\n`);
    
    // Wikipedia'ya giriş yap
    console.log('🔐 Wikipedia\'ya giriş yapılıyor...');
    const configLoaded = await this.loadConfig();
    if (!configLoaded) return;

    const loginSuccess = await this.login();
    if (!loginSuccess) {
      console.error('❌ Giriş başarısız');
      return;
    }

    await this.getEditToken();
    console.log('✅ Bot hazır!\n');
    console.log('═'.repeat(60));
    
    // Her maddeyi işle
    for (let i = 0; i < articles.length; i++) {
      this.processedCount++;
      console.log(`📄 [${i + 1}/${articles.length}]`);
      
      await this.processArticle(articles[i]);
      
      // Rate limiting için bekleme (son madde değilse)
      if (i < articles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    
    // Özet rapor
    console.log('\n' + '═'.repeat(60));
    console.log('📊 İŞLEM RAPORU:');
    console.log('═'.repeat(60));
    console.log(`   📋 Toplam işlenen madde: ${this.processedCount}`);
    console.log(`   ✅ Değiştirilen madde: ${this.changedCount}`);
    console.log(`   ⏭️  Atlanılan madde: ${this.processedCount - this.changedCount - this.errorCount}`);
    console.log(`   ❌ Hatalı madde: ${this.errorCount}`);
    console.log('═'.repeat(60));
  }
}

// CLI programı
program
  .name('futbolcu-bilgikutusu')
  .description('Futbolcu kategorisi olan maddelerde "Bilgi kutusu bulunmayan kişiler" kategorisini "Bilgi kutusu bulunmayan futbolcular" ile değiştirir')
  .version('1.0.0')
  .option('-f, --file <filename>', 'Madde listesi içeren dosya adı', 'maddeler.txt')
  .option('-a, --articles <articles...>', 'Madde adları (komut satırından)')
  .action(async (options) => {
    const manager = new FutbolcuBilgiKutusuManager();
    let articles = [];

    if (options.file) {
      const loadedArticles = await manager.loadArticlesFromFile(options.file);
      if (!loadedArticles) {
        console.error('❌ Dosya okunamadı, işlem durduruluyor');
        return;
      }
      articles = loadedArticles;
    } else if (options.articles && options.articles.length > 0) {
      articles = options.articles;
    } else {
      console.error('❌ Madde listesi veya dosya belirtilmedi');
      console.log('Kullanım:');
      console.log('  node futbolcu_bilgikutusu.js -f maddeler.txt');
      console.log('  node futbolcu_bilgikutusu.js -a "Madde1" "Madde2"');
      return;
    }

    await manager.processArticles(articles);
  });

program.parse();
