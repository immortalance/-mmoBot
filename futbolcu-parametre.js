#!/usr/bin/env node

const { program } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;

class FootballInfoboxEditor {
  constructor() {
    this.trWikiAPI = 'https://tr.wikipedia.org/w/api.php';
    
    this.config = null;
    this.cookies = '';
    this.editToken = null;
    this.userAgent = null;
    this.apiUrl = null;
    
    // Değiştirilecek parametreler
    this.parameterChanges = {
      'adı': 'ad',
      'altyapıyıl': 'altyapıyıl1',
      'altyapı': 'altyapıkulübü1',
      'altyapıkulübü': 'altyapıkulübü1',
      'altyapıkulüp': 'altyapıkulübü1',
      'boy': 'boyu',
      'altyapıkulüp1': 'altyapıkulübü1',
      'altyapıkulüp2': 'altyapıkulübü2',
      'altyapıkulüp3': 'altyapıkulübü3',
      'doğduğuyer': 'doğumyeri',
      'isim': 'ad',
      'tam adı': 'tamadı'
    };
    
    // Silinecek parametreler (değerleriyle birlikte tamamen kaldırılacak)
    // Not: Parametrenin değeri boş olsa bile parametre satırı silinecektir
    this.parametersToDelete = ['toplammaç', 'toplamgol', 'kilo', 'toplammillimaç', 'toplammilligol'];
    
    // İstatistikler
    this.stats = {
      totalProcessed: 0,
      totalModified: 0,
      totalSkipped: 0,
      totalErrors: 0,
      changes: {
        'adı->ad': 0,
        'altyapıyıl->altyapıyıl1': 0,
        'altyapı->altyapıkulübü1': 0,
        'altyapıkulübü->altyapıkulübü1': 0,
        'altyapıkulüp->altyapıkulübü1': 0,
        'boy->boyu': 0,
        'altyapıkulüp1->altyapıkulübü1': 0,
        'altyapıkulüp2->altyapıkulübü2': 0,
        'altyapıkulüp3->altyapıkulübü3': 0,
        'doğduğuyer->doğumyeri': 0,
        'isim->ad': 0,
        'tam adı->tamadı': 0,
        'toplammaç silindi': 0,
        'toplamgol silindi': 0,
        'kilo silindi': 0,
        'toplammillimaç silindi': 0,
        'toplammilligol silindi': 0
      }
    };
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile('config.json', 'utf8');
      this.config = JSON.parse(configData);
      this.apiUrl = this.config.api_url || this.trWikiAPI;
      this.userAgent = this.config.user_agent;
      console.log('✅ Config dosyası yüklendi');
      return true;
    } catch (error) {
      console.error('❌ Config dosyası okunamadı:', error.message);
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
    console.log('🔐 Wikipedia\'ya giriş yapılıyor...');
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
      console.log('✅ Giriş başarılı');
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
    console.log('✅ Edit token alındı');
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

  processInfobox(content) {
    // Futbolcu bilgi kutusu regex pattern'leri
    const infoboxPatterns = [
      /\{\{Futbolcu bilgi kutusu/i,
      /\{\{Futbolcu bilgi/i,
      /\{\{Futbolcu/i,
      /\{\{Futbol oyuncusu/i,
      /\{\{Football player infobox/i
    ];
    
    // Bilgi kutusu var mı kontrol et
    let hasFootballInfobox = false;
    for (const pattern of infoboxPatterns) {
      if (pattern.test(content)) {
        hasFootballInfobox = true;
        break;
      }
    }
    
    if (!hasFootballInfobox) {
      return { modified: false, content: content, changes: [] };
    }

    let modifiedContent = content;
    const changes = [];
    
    // Bilgi kutusunu bul
    let infoboxStart = -1;
    let infoboxEnd = -1;
    let braceCount = 0;
    let inTemplate = false;
    
    // Bilgi kutusunun başlangıcını bul
    for (const pattern of infoboxPatterns) {
      const match = modifiedContent.match(pattern);
      if (match) {
        infoboxStart = match.index;
        break;
      }
    }
    
    if (infoboxStart === -1) {
      return { modified: false, content: content, changes: [] };
    }
    
    // Bilgi kutusunun sonunu bul
    for (let i = infoboxStart; i < modifiedContent.length; i++) {
      if (modifiedContent[i] === '{' && modifiedContent[i + 1] === '{') {
        braceCount++;
        inTemplate = true;
        i++; // İki karakterlik {{ atla
      } else if (modifiedContent[i] === '}' && modifiedContent[i + 1] === '}') {
        braceCount--;
        if (braceCount === 0 && inTemplate) {
          infoboxEnd = i + 2;
          break;
        }
        i++; // İki karakterlik }} atla
      }
    }
    
    if (infoboxEnd === -1) {
      console.error('   ⚠️  Bilgi kutusu sonu bulunamadı');
      return { modified: false, content: content, changes: [] };
    }
    
    let infobox = modifiedContent.substring(infoboxStart, infoboxEnd);
    let originalInfobox = infobox;
    
    // 1. Parametre isimlerini değiştir
    for (const [oldParam, newParam] of Object.entries(this.parameterChanges)) {
      // Çeşitli varyasyonları kontrol et
      const patterns = [
        new RegExp(`\\|\\s*${oldParam}\\s*=`, 'gi'),
        new RegExp(`\\|\\s*${oldParam}\\s*\\n\\s*=`, 'gi')
      ];
      
      for (const pattern of patterns) {
        if (pattern.test(infobox)) {
          infobox = infobox.replace(pattern, (match) => {
            const leadingWhitespace = match.match(/^\|\s*/)[0];
            changes.push(`${oldParam} → ${newParam}`);
            this.stats.changes[`${oldParam}->${newParam}`]++;
            return `${leadingWhitespace}${newParam} =`;
          });
        }
      }
    }
    
    // 2. Silinecek parametreleri kaldır (değerleriyle birlikte)
    // Parametre boş olsa bile satır tamamen silinecektir
    for (const param of this.parametersToDelete) {
      // Parametre ve değerini (boş olsa bile) bul ve sil
      // Önce basit durumları kontrol et: | param = değer |
      let paramPattern = new RegExp(`\\|\\s*${param}\\s*=\\s*[^\\|\\}]*(?=\\||\\}\\})`, 'gi');
      
      if (paramPattern.test(infobox)) {
        infobox = infobox.replace(paramPattern, '');
        changes.push(`${param} silindi`);
        this.stats.changes[`${param} silindi`]++;
      }
      
      // Çok satırlı değerler için daha karmaşık pattern
      // | param = 
      //   değer
      //   değer devamı
      // | sonraki_param
      let multilinePattern = new RegExp(`\\|\\s*${param}\\s*=\\s*[\\s\\S]*?(?=\\n\\s*\\|[^=]|\\}\\})`, 'gi');
      
      if (multilinePattern.test(infobox)) {
        infobox = infobox.replace(multilinePattern, '');
        if (!changes.includes(`${param} silindi`)) {
          changes.push(`${param} silindi`);
          this.stats.changes[`${param} silindi`]++;
        }
      }
    }
    
    // Değişiklik oldu mu kontrol et
    if (infobox !== originalInfobox) {
      modifiedContent = modifiedContent.substring(0, infoboxStart) + 
                       infobox + 
                       modifiedContent.substring(infoboxEnd);
      
      return { 
        modified: true, 
        content: modifiedContent, 
        changes: changes 
      };
    }
    
    return { modified: false, content: content, changes: [] };
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
    formData.append('minor', '1'); // Küçük değişiklik olarak işaretle

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

  async processPage(pageTitle, dryRun = false) {
    console.log(`\n🔄 İşleniyor: ${pageTitle}`);
    
    try {
      // Sayfa içeriğini al
      const content = await this.getPageContent(pageTitle);
      if (!content) {
        console.log('   ❌ Sayfa bulunamadı');
        this.stats.totalErrors++;
        return false;
      }
      
      // Bilgi kutusunu işle
      const result = this.processInfobox(content);
      
      if (!result.modified) {
        console.log('   ⏭️  Değişiklik gerekmedi');
        this.stats.totalSkipped++;
        return false;
      }
      
      console.log(`   ✏️  Yapılan değişiklikler: ${result.changes.join(', ')}`);
      
      if (dryRun) {
        console.log('   🔍 DRY RUN - Değişiklik kaydedilmedi');
        this.stats.totalModified++;
        return true;
      }
      
      // Değişiklikleri kaydet
      const summary = `[[Özel:Fark/36262833|Bot isteği]]`;
      const success = await this.editPage(pageTitle, result.content, summary);
      
      if (success) {
        console.log('   ✅ Değişiklikler kaydedildi');
        this.stats.totalModified++;
        return true;
      } else {
        console.log('   ❌ Kaydetme hatası');
        this.stats.totalErrors++;
        return false;
      }
      
    } catch (error) {
      console.error(`   ❌ Hata: ${error.message}`);
      this.stats.totalErrors++;
      return false;
    }
  }

  async getCategoryMembers(categoryName, namespace = 0) {
    let allMembers = [];
    let cmcontinue = null;

    console.log(`📂 Kategori üyeleri alınıyor: ${categoryName}`);

    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Kategori:${categoryName}`,
        cmnamespace: namespace,
        cmlimit: 500,
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
      
      allMembers = allMembers.concat(members.map(member => member.title));

      cmcontinue = data.continue?.cmcontinue;
      
      if (cmcontinue) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    } while (cmcontinue);

    console.log(`   📊 ${allMembers.length} sayfa bulundu`);
    return allMembers;
  }

  async searchPages(searchTerm, limit = 500) {
    console.log(`🔍 Arama yapılıyor: "${searchTerm}"`);
    
    const params = {
      action: 'query',
      list: 'search',
      srsearch: searchTerm,
      srnamespace: 0,
      srlimit: limit,
      format: 'json'
    };

    const response = await axios.get(this.apiUrl, { 
      params,
      ...this.getRequestConfig()
    });
    
    const results = response.data.query?.search || [];
    const titles = results.map(result => result.title);
    
    console.log(`   📊 ${titles.length} sayfa bulundu`);
    return titles;
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

  printStats() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 İSTATİSTİKLER');
    console.log('='.repeat(60));
    console.log(`İşlenen sayfa sayısı: ${this.stats.totalProcessed}`);
    console.log(`Değiştirilen sayfa sayısı: ${this.stats.totalModified}`);
    console.log(`Değişiklik gerekmeyen sayfa sayısı: ${this.stats.totalSkipped}`);
    console.log(`Hatalı sayfa sayısı: ${this.stats.totalErrors}`);
    console.log('\n📝 Parametre Değişiklikleri:');
    for (const [change, count] of Object.entries(this.stats.changes)) {
      if (count > 0) {
        console.log(`   • ${change}: ${count}`);
      }
    }
    console.log('='.repeat(60));
  }

  async run(options) {
    console.log('🚀 Futbolcu Bilgi Kutusu Düzenleyici başlatılıyor...\n');
    
    // Config dosyasını yükle
    const configLoaded = await this.loadConfig();
    if (!configLoaded) return;

    // Sayfa listesini belirle
    let pages = [];
    
    if (options.category) {
      // Kategoriden sayfaları al
      pages = await this.getCategoryMembers(options.category);
    } else if (options.search) {
      // Arama sonuçlarından sayfaları al
      pages = await this.searchPages(options.search, options.limit || 500);
    } else if (options.file) {
      // Dosyadan sayfaları oku
      const loadedPages = await this.loadPagesFromFile(options.file);
      if (!loadedPages) return;
      pages = loadedPages;
    } else if (options.pages && options.pages.length > 0) {
      // Komut satırından verilen sayfalar
      pages = options.pages;
    } else {
      console.error('❌ Sayfa kaynağı belirtilmedi');
      console.log('Kullanım örnekleri:');
      console.log('  node football-infobox-editor.js --category "Türk futbolcular"');
      console.log('  node football-infobox-editor.js --search "futbolcu bilgi kutusu"');
      console.log('  node football-infobox-editor.js --file sayfalar.txt');
      console.log('  node football-infobox-editor.js --pages "Sayfa1" "Sayfa2"');
      return;
    }

    if (pages.length === 0) {
      console.log('⚠️  İşlenecek sayfa bulunamadı');
      return;
    }

    console.log(`\n📋 Toplam ${pages.length} sayfa işlenecek`);
    
    // Dry run modunda uyarı
    if (options.dryRun) {
      console.log('🔍 DRY RUN MODU - Değişiklikler kaydedilmeyecek\n');
    } else {
      // Wikipedia'ya giriş yap
      const loginSuccess = await this.login();
      if (!loginSuccess) {
        console.error('❌ Giriş başarısız, işlem durduruluyor');
        return;
      }

      await this.getEditToken();
    }

    // Onay iste (dry run değilse)
    if (!options.dryRun && !options.yes) {
      console.log('\n⚠️  DİKKAT: Bu işlem Wikipedia sayfalarında gerçek değişiklikler yapacak!');
      console.log('Devam etmek istiyor musunuz? (evet yazmak için 5 saniyeniz var)');
      
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log('\n⏰ Zaman aşımı - işlem iptal edildi');
          resolve('hayır');
        }, 5000);
        
        rl.question('Cevap: ', (answer) => {
          clearTimeout(timeout);
          rl.close();
          resolve(answer.toLowerCase());
        });
      });
      
      if (answer !== 'evet' && answer !== 'e') {
        console.log('❌ İşlem iptal edildi');
        return;
      }
    }

    console.log('\n🎯 İşlem başlıyor...\n');

    // Sayfaları işle
    for (let i = 0; i < pages.length; i++) {
      const pageTitle = pages[i];
      
      console.log(`\n[${i + 1}/${pages.length}] ${pageTitle}`);
      this.stats.totalProcessed++;
      
      await this.processPage(pageTitle, options.dryRun);
      
      // Rate limiting
      if (i < pages.length - 1 && !options.dryRun) {
        const delay = options.delay || 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      // Her 10 sayfada bir özet göster
      if ((i + 1) % 10 === 0) {
        console.log(`\n📊 Ara özet: ${i + 1}/${pages.length} sayfa işlendi`);
        console.log(`   ✅ Değiştirilen: ${this.stats.totalModified}`);
        console.log(`   ⏭️  Atlanan: ${this.stats.totalSkipped}`);
        console.log(`   ❌ Hatalı: ${this.stats.totalErrors}`);
      }
    }

    // Final istatistikleri göster
    this.printStats();
  }
}

// CLI programını ayarla
program
  .name('football-infobox-editor')
  .description('Türkçe Wikipedia\'da futbolcu bilgi kutularını düzenler')
  .version('1.0.0')
  .option('-c, --category <name>', 'Kategori adı')
  .option('-s, --search <term>', 'Arama terimi')
  .option('-f, --file <filename>', 'Sayfa listesi içeren dosya')
  .option('-p, --pages <pages...>', 'Sayfa isimleri (komut satırından)')
  .option('-l, --limit <number>', 'Arama sonuç limiti', '500')
  .option('-d, --delay <ms>', 'İşlemler arası bekleme süresi (ms)', '1000')
  .option('--dry-run', 'Değişiklikleri göster ama kaydetme')
  .option('-y, --yes', 'Onay isteme')
  .action(async (options) => {
    const editor = new FootballInfoboxEditor();
    await editor.run(options);
  });

// Hata yakalama
process.on('unhandledRejection', (error) => {
  console.error('❌ Beklenmeyen hata:', error);
  process.exit(1);
});

// Programı başlat
program.parse();