#!/usr/bin/env node

const { program } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;

class WikiCategoryManager {
  constructor() {
    this.apiUrl = 'https://tr.wikipedia.org/w/api.php';
    
    this.config = null;
    this.cookies = '';
    this.editToken = null;
    this.userAgent = null;
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile('config.json', 'utf8');
      this.config = JSON.parse(configData);
      this.userAgent = this.config.user_agent;
      return true;
    } catch (error) {
      console.error('❌ Config dosyası okunamadı:', error.message);
      console.log('\n💡 config.json dosyası oluşturun:');
      console.log(JSON.stringify({
        "username": "kullanıcı_adınız",
        "password": "şifreniz",
        "user_agent": "WikiCategoryManager/1.0 (kullanıcı_adınız)"
      }, null, 2));
      return false;
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
        console.error('📝 Sebep:', result.reason);
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

  async getCategoryMembers(categoryName) {
    let allMembers = [];
    let cmcontinue = null;

    console.log(`   📥 "${categoryName}" kategorisi yükleniyor...`);

    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Kategori:${categoryName}`,
        cmlimit: 'max',
        cmtype: 'page',
        format: 'json'
      };

      if (cmcontinue) {
        params.cmcontinue = cmcontinue;
      }

      try {
        const response = await axios.get(this.apiUrl, { params, timeout: 30000 });
        const data = response.data;

        if (data.error) {
          throw new Error(data.error.info);
        }

        if (!data.query || !data.query.categorymembers) {
          throw new Error(`"${categoryName}" kategorisi bulunamadı`);
        }

        allMembers = allMembers.concat(data.query.categorymembers);
        cmcontinue = data.continue?.cmcontinue;

        if (cmcontinue) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (error) {
        if (error.response) {
          throw new Error(`API hatası: ${error.response.status}`);
        }
        throw error;
      }

    } while (cmcontinue);

    console.log(`   ✅ ${allMembers.length} madde bulundu`);
    return allMembers;
  }

  findCommonArticles(members1, members2) {
    return members1.filter(article1 => 
      members2.some(article2 => article2.pageid === article1.pageid)
    );
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

  async removeCategoryFromPage(pageTitle, categoryName) {
    const content = await this.getPageContent(pageTitle);
    if (!content) return { success: false, reason: 'not_found' };

    // Kategori pattern'i oluştur (büyük/küçük harf duyarsız)
    const categoryPattern = new RegExp(
      `\\[\\[Kategori:${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]\\s*`,
      'gi'
    );

    // Kategori var mı kontrol et
    if (!categoryPattern.test(content)) {
      return { success: false, reason: 'not_found' };
    }

    // Kategoriyi kaldır
    const newContent = content.replace(categoryPattern, '');

    // İçerik değişmediyse
    if (newContent === content) {
      return { success: false, reason: 'not_changed' };
    }

    const summary = `[[Kategori:${categoryName}]] kategorisi kaldırıldı`;
    const editSuccess = await this.editPage(pageTitle, newContent, summary);

    return { success: editSuccess, reason: editSuccess ? 'success' : 'edit_failed' };
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

    try {
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
    } catch (error) {
      console.error('   ⚠️ Düzenleme hatası:', error.message);
      return false;
    }
  }

  // KOMUT: find - Ortak maddeleri bul
  async findIntersection(category1, category2, options = {}) {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🔍 KATEGORİ KESİŞİM BULUCU');
      console.log('='.repeat(60));
      console.log(`📂 Kategori 1: ${category1}`);
      console.log(`📂 Kategori 2: ${category2}`);
      console.log('='.repeat(60) + '\n');

      console.log('🔄 Kategoriler yükleniyor...\n');
      
      const [members1, members2] = await Promise.all([
        this.getCategoryMembers(category1),
        this.getCategoryMembers(category2)
      ]);

      console.log('\n🔍 Ortak maddeler aranıyor...');

      const commonArticles = this.findCommonArticles(members1, members2);
      commonArticles.sort((a, b) => a.title.localeCompare(b.title, 'tr'));

      console.log('\n' + '='.repeat(60));
      console.log('📊 SONUÇLAR');
      console.log('='.repeat(60));
      console.log(`📂 Kategori 1 (${category1}): ${members1.length} madde`);
      console.log(`📂 Kategori 2 (${category2}): ${members2.length} madde`);
      console.log(`🎯 Ortak Maddeler: ${commonArticles.length} madde`);
      console.log('='.repeat(60));

      if (commonArticles.length === 0) {
        console.log('\n❌ Ortak madde bulunamadı.');
        return;
      }

      if (options.verbose) {
        console.log('\n📋 ORTAK MADDELER LİSTESİ:\n');
        
        commonArticles.forEach((article, index) => {
          const wikiUrl = `https://tr.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
          console.log(`${(index + 1).toString().padStart(3, ' ')}. ${article.title}`);
          if (options.showUrls) {
            console.log(`     🔗 ${wikiUrl}`);
          }
        });
      } else {
        console.log('\n📋 İLK 10 ORTAK MADDE:\n');
        
        const displayCount = Math.min(10, commonArticles.length);
        for (let i = 0; i < displayCount; i++) {
          const article = commonArticles[i];
          const wikiUrl = `https://tr.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
          console.log(`${(i + 1).toString().padStart(3, ' ')}. ${article.title}`);
          if (options.showUrls) {
            console.log(`     🔗 ${wikiUrl}`);
          }
        }

        if (commonArticles.length > 10) {
          console.log(`\n   ... ve ${commonArticles.length - 10} madde daha`);
          console.log('   💡 Tüm listeyi görmek için --verbose parametresini kullanın');
        }
      }

      if (options.export) {
        const exportData = {
          timestamp: new Date().toISOString(),
          category1: {
            name: category1,
            count: members1.length
          },
          category2: {
            name: category2,
            count: members2.length
          },
          common: {
            count: commonArticles.length,
            articles: commonArticles.map(article => ({
              title: article.title,
              pageid: article.pageid,
              url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(article.title)}`
            }))
          }
        };

        await fs.writeFile(options.export, JSON.stringify(exportData, null, 2));
        console.log(`\n💾 Sonuçlar kaydedildi: ${options.export}`);
      }

      console.log('\n✅ İşlem tamamlandı!\n');

    } catch (error) {
      console.error('\n❌ Hata:', error.message);
      process.exit(1);
    }
  }

  // KOMUT: remove - Kategori kaldır
  async removeCategory(category1, category2, categoryToRemove, options = {}) {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🗑️  KATEGORİ KALDIRMA ARACI');
      console.log('='.repeat(60));
      console.log(`📂 Kategori 1: ${category1}`);
      console.log(`📂 Kategori 2: ${category2}`);
      console.log(`🎯 Kaldırılacak: ${categoryToRemove}`);
      console.log('='.repeat(60) + '\n');

      console.log('🔄 Ortak maddeler bulunuyor...\n');
      
      const [members1, members2] = await Promise.all([
        this.getCategoryMembers(category1),
        this.getCategoryMembers(category2)
      ]);

      const commonArticles = this.findCommonArticles(members1, members2);
      commonArticles.sort((a, b) => a.title.localeCompare(b.title, 'tr'));

      console.log('\n' + '='.repeat(60));
      console.log(`📊 ${commonArticles.length} ortak madde bulundu`);
      console.log('='.repeat(60));

      if (commonArticles.length === 0) {
        console.log('\n❌ Ortak madde bulunamadı.');
        return;
      }

      // Onay iste
      if (!options.force) {
        console.log(`\n⚠️  ${commonArticles.length} maddeden "${categoryToRemove}" kategorisi kaldırılacak!`);
        console.log('\nİlk 10 madde:');
        commonArticles.slice(0, 10).forEach((article, i) => {
          console.log(`   ${i + 1}. ${article.title}`);
        });
        if (commonArticles.length > 10) {
          console.log(`   ... ve ${commonArticles.length - 10} madde daha`);
        }
        
        console.log('\n❓ Devam etmek istiyor musunuz? (y/n)');
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const answer = await new Promise(resolve => {
          rl.question('> ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'evet') {
          console.log('\n❌ İşlem iptal edildi.');
          return;
        }
      }

      // Giriş yap
      console.log('\n🔐 Wikipedia\'ya giriş yapılıyor...');
      const configLoaded = await this.loadConfig();
      if (!configLoaded) return;

      const loginSuccess = await this.login();
      if (!loginSuccess) {
        console.error('❌ Giriş başarısız');
        return;
      }

      await this.getEditToken();
      console.log('✅ Bot hazır!\n');

      // Kategorileri kaldır
      console.log('='.repeat(60));
      console.log('🗑️  Kategoriler kaldırılıyor...');
      console.log('='.repeat(60) + '\n');

      let successCount = 0;
      let notFoundCount = 0;
      let errorCount = 0;

      for (let i = 0; i < commonArticles.length; i++) {
        const article = commonArticles[i];
        
        console.log(`📝 ${i + 1}/${commonArticles.length}: ${article.title}`);
        
        const result = await this.removeCategoryFromPage(article.title, categoryToRemove);
        
        if (result.success) {
          console.log('   ✅ Kategori kaldırıldı');
          successCount++;
        } else if (result.reason === 'not_found') {
          console.log('   ⚠️  Kategori bulunamadı (zaten yok olabilir)');
          notFoundCount++;
        } else {
          console.log('   ❌ Hata oluştu');
          errorCount++;
        }

        if (i < commonArticles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('📋 İŞLEM ÖZETİ:');
      console.log(`   ✅ Başarılı: ${successCount}`);
      console.log(`   ⚠️  Bulunamadı: ${notFoundCount}`);
      console.log(`   ❌ Hatalı: ${errorCount}`);
      console.log(`   📊 Toplam: ${commonArticles.length}`);
      console.log('='.repeat(60));
      console.log('\n✅ İşlem tamamlandı!\n');

    } catch (error) {
      console.error('\n❌ Hata:', error.message);
      process.exit(1);
    }
  }
}

// CLI Komutları
program
  .name('wiki-category')
  .description('Türkçe Wikipedia kategori yönetim aracı')
  .version('1.0.0');

// find komutu - Ortak maddeleri bul
program
  .command('find <category1> <category2>')
  .description('İki kategorideki ortak maddeleri bulur')
  .option('-v, --verbose', 'Tüm ortak maddeleri göster')
  .option('-u, --show-urls', 'Madde URL\'lerini göster')
  .option('-e, --export <filename>', 'Sonuçları JSON dosyasına kaydet')
  .action(async (category1, category2, options) => {
    const manager = new WikiCategoryManager();
    await manager.findIntersection(category1, category2, options);
  });

// remove komutu - Kategori kaldır
program
  .command('remove <category1> <category2> <removeCategory>')
  .description('İki kategorideki ortak maddelerden belirtilen kategoriyi kaldırır')
  .option('-f, --force', 'Onay istemeden direkt işlemi başlat')
  .action(async (category1, category2, removeCategory, options) => {
    const manager = new WikiCategoryManager();
    await manager.removeCategory(category1, category2, removeCategory, options);
  });

program.parse();