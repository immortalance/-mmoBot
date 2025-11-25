#!/usr/bin/env node

const { program } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;

class WikiSourceTemplateManager {
  constructor() {
    this.trWikiAPI = 'https://tr.wikipedia.org/w/api.php';
    
    this.config = null;
    this.cookies = '';
    this.editToken = null;
    this.userAgent = null;
    this.apiUrl = null;
    
    // Kaynaksız şablonları
    this.unsourcedTemplates = [
      'Kaynaksız',
      'Kaynak yok',
      'Kaynak belirtilmeli',
      'Kaynak eksik',
      'Unreferenced',
      'Unsourced',
      'Refimprove',
      'Kaynak az',
      'Daha fazla kaynak',
      'Daha fazla dipnot'
    ];
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

  async loadPagesFromFile(filename) {
    try {
      const fileContent = await fs.readFile(filename, 'utf8');
      const pages = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
      
      console.log(`📋 ${filename} dosyasından ${pages.length} sayfa okundu`);
      return pages;
    } catch (error) {
      console.error('❌ Sayfa listesi dosyası okunamadı:', error.message);
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

  async getPagesWithUnsourcedTemplate(categoryName) {
    let allPages = [];
    let cmcontinue = null;

    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Kategori:${categoryName}`,
        cmlimit: 500,
        cmtype: 'page',
        format: 'json'
      };

      if (cmcontinue) {
        params.cmcontinue = cmcontinue;
      }

      const response = await axios.get(this.apiUrl, {
        params,
        ...this.getRequestConfig()
      });
      
      const data = response.data;
      const members = data.query?.categorymembers || [];
      
      allPages = allPages.concat(members.map(member => member.title));

      cmcontinue = data.continue?.cmcontinue;
      
      if (cmcontinue) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } while (cmcontinue);

    return allPages;
  }

  hasReferences(content) {
    // Yorumları kaldır (yorumdaki ref'leri saymaması için)
    const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
    
    // <ref> etiketini kontrol et
    // <ref>, <ref name="...">, <ref group="...">, <ref /> vb. hepsini kapsar
    return /<ref[^>]*>[\s\S]*?<\/ref>|<ref[^/>]*\/>/i.test(contentWithoutComments);
  }

  isDraftPage(pageTitle, content) {
    // 1. İsim alanı kontrolü (Taslak: ile başlıyor mu?)
    if (pageTitle.startsWith('Taslak:')) {
      return true;
    }
    
    // 2. İçerikte taslak şablonu kontrolü
    const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
    
    // Şablon adında "taslak" veya "stub" geçen tüm şablonları bul
    // Örnekler: {{Taslak}}, {{türk-biyo-taslak}}, {{fizik-taslak}}, {{stub}}, {{bio-stub}} vb.
    const draftTemplatePattern = /\{\{[^}]*(?:taslak|stub)[^}]*\}\}/gi;
    
    const foundDraftTemplates = contentWithoutComments.match(draftTemplatePattern);
    
    if (foundDraftTemplates && foundDraftTemplates.length > 0) {
      // Debug için bulunan taslak şablonlarını göster
      console.log(`   📝 Taslak şablonları bulundu: ${foundDraftTemplates.join(', ')}`);
      return true;
    }
    
    return false;
  }

  findUnsourcedTemplates(content) {
    const foundTemplates = [];
    
    for (const templateName of this.unsourcedTemplates) {
      // Farklı varyasyonları kontrol et
      const patterns = [
        new RegExp(`\\{\\{${templateName}[^}]*\\}\\}`, 'gi'),
        new RegExp(`\\{\\{${templateName.toLowerCase()}[^}]*\\}\\}`, 'gi'),
        new RegExp(`\\{\\{${templateName.charAt(0).toUpperCase() + templateName.slice(1).toLowerCase()}[^}]*\\}\\}`, 'gi')
      ];
      
      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          foundTemplates.push(...matches);
        }
      }
    }
    
    return [...new Set(foundTemplates)]; // Tekrarları kaldır
  }

  removeUnsourcedTemplates(content, templatesToRemove) {
    let newContent = content;
    
    for (const template of templatesToRemove) {
      // Şablonu ve etrafındaki boşlukları kaldır
      const escapedTemplate = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\s*${escapedTemplate}\\s*\\n?`, 'g');
      newContent = newContent.replace(pattern, '\n');
    }
    
    // Ardışık boş satırları temizle
    newContent = newContent.replace(/\n{3,}/g, '\n\n');
    
    return newContent.trim();
  }

  async processPage(pageTitle) {
    try {
      const content = await this.getPageContent(pageTitle);
      if (!content) {
        console.log('   ⚠️  Sayfa bulunamadı');
        return { status: 'notfound', removed: 0, reason: null };
      }

      // Kaynaksız şablonlarını bul
      const unsourcedTemplates = this.findUnsourcedTemplates(content);
      
      if (unsourcedTemplates.length === 0) {
        console.log('   ℹ️  Kaynaksız şablonu yok');
        return { status: 'no_template', removed: 0, reason: null };
      }

      console.log(`   📌 ${unsourcedTemplates.length} kaynaksız şablonu bulundu`);

      // Taslak madde kontrolü
      const isDraft = this.isDraftPage(pageTitle, content);
      let removalReason = null;
      let shouldRemove = false;

      if (isDraft) {
        console.log('   📝 Taslak madde tespit edildi');
        shouldRemove = true;
        removalReason = 'draft';
      } else {
        // Kaynak kontrolü (taslak değilse)
        const hasRefs = this.hasReferences(content);
        
        if (!hasRefs) {
          console.log('   ⚠️  <ref> etiketi bulunamadı, şablon korunuyor');
          return { status: 'no_sources', removed: 0, reason: null };
        }
        
        console.log('   ✅ <ref> etiketi mevcut');
        shouldRemove = true;
        removalReason = 'has_sources';
      }

      if (shouldRemove) {
        console.log('   🗑️  Şablonlar kaldırılıyor...');
        
        // Şablonları kaldır
        const newContent = this.removeUnsourcedTemplates(content, unsourcedTemplates);
        
        if (newContent === content) {
          console.log('   ℹ️  İçerik değişmedi');
          return { status: 'unchanged', removed: 0, reason: removalReason };
        }

        // Düzenleme özeti hazırla
        let summary;
        if (removalReason === 'draft') {
          summary = `Bot: Taslak maddeden ${unsourcedTemplates.length} kaynaksız şablonu kaldırıldı`;
        } else {
          summary = `Bot: ${unsourcedTemplates.length} kaynaksız şablonu kaldırıldı (maddede <ref> etiketi mevcut)`;
        }

        // Sayfayı güncelle
        const success = await this.editPage(pageTitle, newContent, summary);
        
        if (success) {
          console.log(`   ✅ ${unsourcedTemplates.length} şablon kaldırıldı`);
          return { status: 'success', removed: unsourcedTemplates.length, reason: removalReason };
        } else {
          console.log('   ❌ Düzenleme başarısız');
          return { status: 'error', removed: 0, reason: removalReason };
        }
      }

    } catch (error) {
      console.error(`   ❌ Hata: ${error.message}`);
      return { status: 'error', removed: 0, reason: null };
    }
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

  async processPages(pageList) {
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

    const stats = {
      total: pageList.length,
      processed: 0,
      templatesRemoved: 0,
      removedFromDrafts: 0,
      removedWithSources: 0,
      noTemplate: 0,
      noSources: 0,
      notFound: 0,
      errors: 0
    };

    for (let i = 0; i < pageList.length; i++) {
      const pageTitle = pageList[i];
      
      console.log(`\n[${i + 1}/${pageList.length}] 📄 ${pageTitle}`);
      
      const result = await this.processPage(pageTitle);
      stats.processed++;
      
      switch(result.status) {
        case 'success':
          stats.templatesRemoved += result.removed;
          if (result.reason === 'draft') {
            stats.removedFromDrafts += result.removed;
          } else if (result.reason === 'has_sources') {
            stats.removedWithSources += result.removed;
          }
          break;
        case 'no_template':
          stats.noTemplate++;
          break;
        case 'no_sources':
          stats.noSources++;
          break;
        case 'notfound':
          stats.notFound++;
          break;
        case 'error':
          stats.errors++;
          break;
      }

      // Rate limiting
      if (i < pageList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 İŞLEM SONUCU:');
    console.log(`   📋 Toplam sayfa: ${stats.total}`);
    console.log(`   ✅ İşlenen: ${stats.processed}`);
    console.log(`   🗑️  Kaldırılan toplam şablon: ${stats.templatesRemoved}`);
    console.log(`      📝 Taslaklardan kaldırılan: ${stats.removedFromDrafts}`);
    console.log(`      📚 Kaynaklı maddelerden kaldırılan: ${stats.removedWithSources}`);
    console.log(`   ℹ️  Şablon bulunmayan: ${stats.noTemplate}`);
    console.log(`   ⚠️  <ref> etiketi olmayan: ${stats.noSources}`);
    console.log(`   ❓ Bulunamayan sayfa: ${stats.notFound}`);
    console.log(`   ❌ Hatalı: ${stats.errors}`);
    console.log('='.repeat(60));
  }

  async processCategoryPages(categoryName) {
    console.log(`📂 "${categoryName}" kategorisindeki sayfalar alınıyor...`);
    const pages = await this.getPagesWithUnsourcedTemplate(categoryName);
    
    if (!pages || pages.length === 0) {
      console.log('⚠️  Kategoride sayfa bulunamadı');
      return;
    }

    console.log(`📋 ${pages.length} sayfa bulundu\n`);
    await this.processPages(pages);
  }
}

// CLI tanımlamaları
program
  .name('wiki-source-template-manager')
  .description('Wikipedia kaynaksız şablonlarını yönetir')
  .version('1.0.0')
  .option('-f, --file <filename>', 'Sayfa listesi içeren dosya', 'sayfalar.txt')
  .option('-p, --pages <pages...>', 'Sayfa adları (komut satırından)')
  .option('-c, --category <category>', 'Kategori adı (örn: "Kaynaksız maddeler")')
  .option('--dry-run', 'Sadece kontrol yap, düzenleme yapma')
  .action(async (options) => {
    const manager = new WikiSourceTemplateManager();
    
    if (options.dryRun) {
      console.log('🔍 DRY RUN modu - sadece kontrol yapılacak\n');
      manager.editPage = async () => true; // Override edit function
    }

    if (options.category) {
      await manager.processCategoryPages(options.category);
    } else {
      let pageList = [];
      
      if (options.pages && options.pages.length > 0) {
        pageList = options.pages;
      } else if (options.file) {
        pageList = await manager.loadPagesFromFile(options.file);
        if (!pageList) {
          console.error('❌ Dosya okunamadı');
          return;
        }
      } else {
        console.error('❌ Sayfa listesi, dosya veya kategori belirtilmedi');
        console.log('\nKullanım örnekleri:');
        console.log('  node unsourced.js -f sayfalar.txt');
        console.log('  node unsourced.js -p "Sayfa1" "Sayfa2"');
        console.log('  node unsourced.js -c "Kaynaksız maddeler"');
        console.log('  node unsourced.js --dry-run -c "Test kategorisi"');
        return;
      }

      await manager.processPages(pageList);
    }
  });

program.parse();