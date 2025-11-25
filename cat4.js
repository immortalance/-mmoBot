#!/usr/bin/env node

const { program } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;

class WikiCategoryManager {
  constructor() {
    this.enWikiAPI = 'https://en.wikipedia.org/w/api.php';
    this.trWikiAPI = 'https://tr.wikipedia.org/w/api.php';
    this.wikidataAPI = 'https://www.wikidata.org/w/api.php';
    
    this.config = null;
    this.cookies = '';
    this.editToken = null;
    this.userAgent = null;
    this.apiUrl = null;
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

  async loadCategoriesFromFile(filename) {
    try {
      const fileContent = await fs.readFile(filename, 'utf8');
      const categories = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
      
      console.log(`📋 ${filename} dosyasından ${categories.length} kategori okundu`);
      return categories;
    } catch (error) {
      console.error('❌ Kategori dosyası okunamadı:', error.message);
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

  async getEnglishCategoryMembers(categoryName) {
    let allMembers = [];
    let cmcontinue = null;

    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Category:${categoryName}`,
        cmlimit: 500,
        format: 'json'
      };

      if (cmcontinue) {
        params.cmcontinue = cmcontinue;
      }

      const response = await axios.get(this.enWikiAPI, { 
        params,
        headers: {
          'User-Agent': 'WikiCategoryBot/1.0 (https://tr.wikipedia.org/)'
        }
      });
      const data = response.data;
      const members = data.query?.categorymembers || [];
      
      allMembers = allMembers.concat(members.map(member => ({
        title: member.title,
        pageid: member.pageid
      })));

      cmcontinue = data.continue?.cmcontinue;
      
      if (cmcontinue) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } while (cmcontinue);

    return allMembers;
  }

  async getTurkishCategoryMembers(categoryName) {
    let allMembers = [];
    let cmcontinue = null;

    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Kategori:${categoryName}`,
        cmlimit: 500,
        format: 'json'
      };

      if (cmcontinue) {
        params.cmcontinue = cmcontinue;
      }

      const response = await axios.get(this.trWikiAPI, { 
        params,
        headers: {
          'User-Agent': 'WikiCategoryBot/1.0 (https://tr.wikipedia.org/)'
        }
      });
      const data = response.data;
      const members = data.query?.categorymembers || [];
      
      allMembers = allMembers.concat(members);

      cmcontinue = data.continue?.cmcontinue;
      
      if (cmcontinue) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } while (cmcontinue);

    return new Set(allMembers.map(member => member.title));
  }

  async getTurkishWikidataId(trTitle) {
    const params = {
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      titles: trTitle,
      format: 'json'
    };

    const response = await axios.get(this.trWikiAPI, { 
      params,
      headers: {
        'User-Agent': 'WikiCategoryBot/1.0 (https://tr.wikipedia.org/)'
      }
    });
    const pages = response.data.query?.pages || {};
    
    for (const pageId in pages) {
      const page = pages[pageId];
      if (page.pageprops?.wikibase_item) {
        return page.pageprops.wikibase_item;
      }
    }
    return null;
  }

  async getMultipleWikidataIds(titles) {
    const params = {
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      titles: titles.join('|'),
      format: 'json'
    };

    const response = await axios.get(this.enWikiAPI, { 
      params,
      headers: {
        'User-Agent': 'WikiCategoryBot/1.0 (https://tr.wikipedia.org/)'
      }
    });
    const pages = response.data.query?.pages || {};
    
    const results = {};
    for (const pageId in pages) {
      const page = pages[pageId];
      if (page.title && page.pageprops?.wikibase_item) {
        results[page.title] = page.pageprops.wikibase_item;
      }
    }
    return results;
  }

  async getMultipleTurkishTitles(wikidataIds) {
    const params = {
      action: 'wbgetentities',
      ids: wikidataIds.join('|'),
      props: 'sitelinks',
      sitefilter: 'trwiki',
      format: 'json'
    };

    const response = await axios.get(this.wikidataAPI, { params, headers: { "User-Agent": "WikiCategoryBot/1.0 (https://tr.wikipedia.org/)" } });
    const entities = response.data.entities || {};
    
    const results = {};
    for (const id in entities) {
      if (entities[id]?.sitelinks?.trwiki) {
        results[id] = entities[id].sitelinks.trwiki.title;
      }
    }
    return results;
  }

  async getEnglishTitle(wikidataId) {
    const params = {
      action: 'wbgetentities',
      ids: wikidataId,
      props: 'sitelinks',
      sitefilter: 'enwiki',
      format: 'json'
    };

    const response = await axios.get(this.wikidataAPI, { params, headers: { "User-Agent": "WikiCategoryBot/1.0 (https://tr.wikipedia.org/)" } });
    const entity = response.data.entities?.[wikidataId];
    
    if (entity?.sitelinks?.enwiki) {
      return entity.sitelinks.enwiki.title;
    }
    return null;
  }

  async getEnglishCategoryName(turkishCategoryName) {
    const wikidataId = await this.getTurkishWikidataId(`Kategori:${turkishCategoryName}`);
    if (!wikidataId) {
      throw new Error(`Türkçe kategori için Wikidata ID bulunamadı: ${turkishCategoryName}`);
    }

    const englishCategoryName = await this.getEnglishTitle(wikidataId);
    if (!englishCategoryName) {
      throw new Error(`İngilizce kategori karşılığı bulunamadı: ${turkishCategoryName}`);
    }

    return englishCategoryName.replace('Category:', '');
  }

  async findMissingArticles(turkishCategoryName) {
    console.log(`🔍 Kategori analiz ediliyor: ${turkishCategoryName}`);
    
    const englishCategoryName = await this.getEnglishCategoryName(turkishCategoryName);
    console.log(`📋 İngilizce karşılık: ${englishCategoryName}`);
    
    const englishArticles = await this.getEnglishCategoryMembers(englishCategoryName);
    const turkishArticles = await this.getTurkishCategoryMembers(turkishCategoryName);
    
    console.log(`📊 İngilizce: ${englishArticles.length} madde | Türkçe: ${turkishArticles.size} madde`);
    console.log(`🔄 Eksik maddeler kontrol ediliyor...`);
    
    const missingArticles = [];
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < englishArticles.length; i += BATCH_SIZE) {
      const batch = englishArticles.slice(i, Math.min(i + BATCH_SIZE, englishArticles.length));
      const titles = batch.map(a => a.title);
      
      const currentProgress = Math.min(i + BATCH_SIZE, englishArticles.length);
      process.stdout.write(`\r   📊 İlerleme: ${currentProgress}/${englishArticles.length} (${Math.round(currentProgress / englishArticles.length * 100)}%)`);
      
      try {
        // 1. Tüm İngilizce başlıklar için Wikidata ID'lerini al
        const wikidataIds = await this.getMultipleWikidataIds(titles);
        
        // 2. Bulunan Wikidata ID'leri için Türkçe başlıkları al
        const validIds = Object.values(wikidataIds).filter(id => id);
        if (validIds.length > 0) {
          const turkishTitles = await this.getMultipleTurkishTitles(validIds);
          
          // 3. Eksik olanları bul
          for (const article of batch) {
            const wikidataId = wikidataIds[article.title];
            if (!wikidataId) continue;
            
            const turkishTitle = turkishTitles[wikidataId];
            if (!turkishTitle) continue;
            
            if (!turkishArticles.has(turkishTitle)) {
              missingArticles.push({
                english: article.title,
                turkish: turkishTitle,
                wikidataId: wikidataId
              });
            }
          }
        }
      } catch (error) {
        console.error(`\n⚠️  Batch hatası (${i}-${i + batch.length}):`, error.message);
      }
      
      // Rate limiting için bekleme
      if (i + BATCH_SIZE < englishArticles.length) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
    
    console.log(`\n✅ Analiz tamamlandı: ${missingArticles.length} eksik madde bulundu`);
    return missingArticles;
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

  async addCategoryToPage(pageTitle, categoryName) {
    const content = await this.getPageContent(pageTitle);
    if (!content) return false;

    const categoryPattern = new RegExp(`\\[\\[Kategori:${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'i');
    
    const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
    if (categoryPattern.test(contentWithoutComments)) {
      return true;
    }

    let newContent = content;
    const categoryToAdd = `[[Kategori:${categoryName}]]`;

    const commentPlaceholder = '___COMMENT_BLOCK___';
    const comments = [];
    let categoryFoundInComment = false;
    
    let contentWithPlaceholders = content.replace(/<!--[\s\S]*?-->/g, (match) => {
      if (categoryPattern.test(match)) {
        categoryFoundInComment = true;
        match = match.replace(new RegExp(`\\s*${categoryPattern.source}\\s*`, 'gi'), '\n');
      }
      comments.push(match);
      return commentPlaceholder + (comments.length - 1);
    });

    const categoryRegex = /\[\[Kategori:[^\]]+\]\]/g;
    const existingCategories = contentWithPlaceholders.match(categoryRegex);
    
    if (existingCategories && existingCategories.length > 0) {
      const lastCategoryIndex = contentWithPlaceholders.lastIndexOf('[[Kategori:');
      const lastCategoryEnd = contentWithPlaceholders.indexOf(']]', lastCategoryIndex) + 2;
      
      contentWithPlaceholders = contentWithPlaceholders.slice(0, lastCategoryEnd) + '\n' + categoryToAdd + contentWithPlaceholders.slice(lastCategoryEnd);
    } else {
      contentWithPlaceholders = contentWithPlaceholders.trim() + '\n\n' + categoryToAdd;
    }

    newContent = contentWithPlaceholders.replace(new RegExp(commentPlaceholder + '(\\d+)', 'g'), (match, index) => {
      return comments[parseInt(index)];
    });

    const summary = categoryFoundInComment 
      ? `[[Kategori:${categoryName}]] kategorisi yorumdan çıkarıldı ve aktif hale getirildi`
      : `[[Kategori:${categoryName}]] kategorisi eklendi`;

    return await this.editPage(pageTitle, newContent, summary);
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

  async processCategory(turkishCategoryName) {
    try {
      const missingArticles = await this.findMissingArticles(turkishCategoryName);
      
      if (missingArticles.length === 0) {
        console.log('✅ Tüm maddeler kategoride mevcut!');
        return { successCount: 0, errorCount: 0 };
      }

      console.log(`\n🎯 ${missingArticles.length} maddeye kategori eklenecek`);
      
      if (!this.editToken) {
        console.log('🔐 Wikipedia\'ya giriş yapılıyor...');
        const configLoaded = await this.loadConfig();
        if (!configLoaded) return { successCount: 0, errorCount: 0 };

        const loginSuccess = await this.login();
        if (!loginSuccess) {
          console.error('❌ Giriş başarısız');
          return { successCount: 0, errorCount: 0 };
        }

        await this.getEditToken();
        console.log('✅ Bot hazır!\n');
      }

      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < missingArticles.length; i++) {
        const article = missingArticles[i];
        
        console.log(`🔄 ${i + 1}/${missingArticles.length}: ${article.turkish}`);
        
        const success = await this.addCategoryToPage(article.turkish, turkishCategoryName);
        
        if (success) {
          console.log('   ✅ Kategori eklendi');
          successCount++;
        } else {
          console.log('   ❌ Hata oluştu');
          errorCount++;
        }

        if (i < missingArticles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log('\n' + '='.repeat(50));
      console.log('📋 İŞLEM ÖZETİ:');
      console.log(`   ✅ Başarılı: ${successCount}`);
      console.log(`   ❌ Hatalı: ${errorCount}`);
      console.log(`   📊 Toplam: ${missingArticles.length}`);
      console.log('='.repeat(50));

      return { successCount, errorCount };

    } catch (error) {
      console.error('❌ İşlem hatası:', error.message);
      return { successCount: 0, errorCount: 0 };
    }
  }
}

program
  .name('wiki-category-manager')
  .description('Türkçe Wikipedia kategorilerini yönetir')
  .version('1.0.0')
  .option('-f, --file <filename>', 'Kategori listesi içeren dosya adı', 'kategoriler.txt')
  .option('-c, --categories <categories...>', 'Kategori adları (komut satırından)')
  .action(async (options) => {
    const manager = new WikiCategoryManager();
    let categoryNames = [];

    if (options.file) {
      const loadedCategories = await manager.loadCategoriesFromFile(options.file);
      if (!loadedCategories) {
        console.error('❌ Dosya okunamadı, işlem durduruluyor');
        return;
      }
      categoryNames = loadedCategories;
    } else if (options.categories && options.categories.length > 0) {
      categoryNames = options.categories;
    } else {
      console.error('❌ Kategori listesi veya dosya belirtilmedi');
      console.log('Kullanım:');
      console.log('  node cat.js -f kategoriler.txt');
      console.log('  node cat.js -c "Kategori1" "Kategori2"');
      return;
    }

    console.log(`🎯 ${categoryNames.length} kategori işlenecek\n`);
    
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    
    for (let i = 0; i < categoryNames.length; i++) {
      const categoryName = categoryNames[i];
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📂 KATEGORİ ${i + 1}/${categoryNames.length}: ${categoryName}`);
      console.log(`${'='.repeat(60)}`);
      
      try {
        const result = await manager.processCategory(categoryName);
        if (result) {
          totalSuccess += result.successCount || 0;
          totalErrors += result.errorCount || 0;
          totalProcessed += (result.successCount || 0) + (result.errorCount || 0);
        }
        
        if (i < categoryNames.length - 1) {
          console.log('\n⏳ Sonraki kategoriye geçiliyor...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ ${categoryName} kategorisi işlenirken hata:`, error.message);
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('📋 GENEL ÖZET:');
    console.log(`   📂 İşlenen kategori: ${categoryNames.length}`);
    console.log(`   📊 Toplam işlenen madde: ${totalProcessed}`);
    console.log(`   ✅ Toplam başarılı: ${totalSuccess}`);
    console.log(`   ❌ Toplam hatalı: ${totalErrors}`);
    console.log(`${'='.repeat(60)}`);
  });

program.parse();