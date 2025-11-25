#!/usr/bin/env node

const { program } = require('commander');
const axios = require('axios');

class CategoryIntersectionFinder {
  constructor() {
    this.apiUrls = {
      'tr': 'https://tr.wikipedia.org/w/api.php',
      'en': 'https://en.wikipedia.org/w/api.php',
      'de': 'https://de.wikipedia.org/w/api.php',
      'fr': 'https://fr.wikipedia.org/w/api.php',
      'es': 'https://es.wikipedia.org/w/api.php',
      'it': 'https://it.wikipedia.org/w/api.php',
      'pt': 'https://pt.wikipedia.org/w/api.php',
      'ru': 'https://ru.wikipedia.org/w/api.php',
      'ja': 'https://ja.wikipedia.org/w/api.php',
      'zh': 'https://zh.wikipedia.org/w/api.php'
    };
  }

  async getCategoryMembers(categoryName, lang = 'tr') {
    const apiUrl = this.apiUrls[lang];
    if (!apiUrl) {
      throw new Error(`Desteklenmeyen dil kodu: ${lang}`);
    }

    const categoryPrefix = lang === 'en' ? 'Category' : 'Kategori';
    let allMembers = [];
    let cmcontinue = null;

    console.log(`   📥 "${categoryName}" kategorisi yükleniyor...`);

    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `${categoryPrefix}:${categoryName}`,
        cmlimit: 'max',
        cmtype: 'page',
        format: 'json'
      };

      if (cmcontinue) {
        params.cmcontinue = cmcontinue;
      }

      try {
        const response = await axios.get(apiUrl, { 
          params,
          timeout: 30000 
        });
        
        const data = response.data;

        if (data.error) {
          throw new Error(data.error.info);
        }

        if (!data.query || !data.query.categorymembers) {
          throw new Error(`"${categoryName}" kategorisi bulunamadı`);
        }

        const members = data.query.categorymembers;
        allMembers = allMembers.concat(members);

        cmcontinue = data.continue?.cmcontinue;

        // Rate limiting
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
    const commonArticles = members1.filter(article1 => 
      members2.some(article2 => article2.pageid === article1.pageid)
    );

    return commonArticles;
  }

  async processCategories(category1, category2, lang = 'tr', options = {}) {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🔍 KATEGORİ KESİŞİM BULUCU');
      console.log('='.repeat(60));
      console.log(`📋 Dil: ${lang.toUpperCase()}`);
      console.log(`📂 Kategori 1: ${category1}`);
      console.log(`📂 Kategori 2: ${category2}`);
      console.log('='.repeat(60) + '\n');

      // Her iki kategoriyi paralel olarak al
      console.log('🔄 Kategoriler yükleniyor...\n');
      
      const [members1, members2] = await Promise.all([
        this.getCategoryMembers(category1, lang),
        this.getCategoryMembers(category2, lang)
      ]);

      console.log('\n🔍 Ortak maddeler aranıyor...');

      // Kesişimi bul
      const commonArticles = this.findCommonArticles(members1, members2);

      // Alfabetik sırala
      commonArticles.sort((a, b) => a.title.localeCompare(b.title, lang));

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

      // Sonuçları göster
      if (options.verbose) {
        console.log('\n📋 ORTAK MADDELER LİSTESİ:\n');
        
        commonArticles.forEach((article, index) => {
          const wikiUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
          console.log(`${(index + 1).toString().padStart(3, ' ')}. ${article.title}`);
          if (options.showUrls) {
            console.log(`     🔗 ${wikiUrl}`);
          }
        });
      } else {
        // Sadece ilk 10'u göster
        console.log('\n📋 İLK 10 ORTAK MADDE:\n');
        
        const displayCount = Math.min(10, commonArticles.length);
        for (let i = 0; i < displayCount; i++) {
          const article = commonArticles[i];
          const wikiUrl = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.title)}`;
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

      // JSON export
      if (options.export) {
        const fs = require('fs');
        const exportData = {
          timestamp: new Date().toISOString(),
          language: lang,
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
              url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(article.title)}`
            }))
          }
        };

        const filename = options.export;
        fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
        console.log(`\n💾 Sonuçlar kaydedildi: ${filename}`);
      }

      console.log('\n✅ İşlem tamamlandı!\n');

    } catch (error) {
      console.error('\n❌ Hata:', error.message);
      process.exit(1);
    }
  }
}

program
  .name('wiki-intersection')
  .description('İki Wikipedia kategorisindeki ortak maddeleri bulur')
  .version('1.0.0')
  .argument('<category1>', 'Birinci kategori adı (Kategori: öneki olmadan)')
  .argument('<category2>', 'İkinci kategori adı (Kategori: öneki olmadan)')
  .option('-l, --lang <language>', 'Wikipedia dil kodu (tr, en, de, fr, vb.)', 'tr')
  .option('-v, --verbose', 'Tüm ortak maddeleri göster')
  .option('-u, --show-urls', 'Madde URL\'lerini göster')
  .option('-e, --export <filename>', 'Sonuçları JSON dosyasına kaydet')
  .action(async (category1, category2, options) => {
    const finder = new CategoryIntersectionFinder();
    await finder.processCategories(category1, category2, options.lang, options);
  });

program.parse();