/**
 * Wikipedia Category Comparison Tool - Node.js Version
 * Compares categories between English and Turkish Wikipedia
 * Automatically finds English category name from Turkish via Wikidata
 */

const https = require('https');

class WikipediaCategoryComparer {
    constructor() {
        this.enApi = 'en.wikipedia.org';
        this.trApi = 'tr.wikipedia.org';
        this.wikidataApi = 'www.wikidata.org';
    }

    /**
     * Make an HTTPS request to Wikipedia API
     */
    makeRequest(hostname, path) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: hostname,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'WikipediaCategoryComparer/1.0'
                }
            };

            https.get(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Get English category name from Turkish category using Wikidata
     */
    async getEnglishCategoryFromTurkish(trCategory) {
        console.log(`\nSearching for English equivalent of "${trCategory}"...`);
        
        try {
            // First, get the Wikidata ID from Turkish Wikipedia
            const trPath = `/w/api.php?action=query&titles=Kategori:${encodeURIComponent(trCategory)}&prop=pageprops&format=json`;
            const trData = await this.makeRequest(this.trApi, trPath);
            
            let wikidataId = null;
            if (trData.query && trData.query.pages) {
                const pages = trData.query.pages;
                const pageId = Object.keys(pages)[0];
                
                if (pageId !== '-1' && pages[pageId].pageprops && pages[pageId].pageprops.wikibase_item) {
                    wikidataId = pages[pageId].pageprops.wikibase_item;
                    console.log(`Found Wikidata ID: ${wikidataId}`);
                }
            }
            
            if (!wikidataId) {
                console.log('Could not find Wikidata ID for Turkish category');
                return null;
            }
            
            // Get English Wikipedia sitelink from Wikidata
            const wdPath = `/w/api.php?action=wbgetentities&ids=${wikidataId}&props=sitelinks&sitefilter=enwiki&format=json`;
            const wdData = await this.makeRequest(this.wikidataApi, wdPath);
            
            if (wdData.entities && wdData.entities[wikidataId] && 
                wdData.entities[wikidataId].sitelinks && 
                wdData.entities[wikidataId].sitelinks.enwiki) {
                
                const enTitle = wdData.entities[wikidataId].sitelinks.enwiki.title;
                // Remove "Category:" prefix
                const enCategory = enTitle.replace('Category:', '');
                console.log(`Found English category: ${enCategory}`);
                return enCategory;
            }
            
            console.log('Could not find English Wikipedia link in Wikidata');
            return null;
            
        } catch (error) {
            console.error('Error finding English category:', error.message);
            return null;
        }
    }

    /**
     * Get Wikidata IDs for multiple categories at once (batch)
     */
    async getWikidataIdsBatch(categoryNames) {
        const titles = categoryNames.map(name => `Category:${name}`).join('|');
        const enPath = `/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageprops&format=json`;
        
        try {
            const enData = await this.makeRequest(this.enApi, enPath);
            const wikidataMap = new Map();
            
            if (enData.query && enData.query.pages) {
                for (const pageId in enData.query.pages) {
                    const page = enData.query.pages[pageId];
                    if (pageId !== '-1' && page.pageprops && page.pageprops.wikibase_item) {
                        const categoryName = page.title.replace('Category:', '');
                        wikidataMap.set(categoryName, page.pageprops.wikibase_item);
                    }
                }
            }
            
            return wikidataMap;
        } catch (error) {
            console.error('Error getting Wikidata IDs:', error.message);
            return new Map();
        }
    }

    /**
     * Check Turkish equivalents for multiple Wikidata IDs at once (batch)
     */
    async checkTurkishEquivalentsBatch(wikidataIds) {
        const ids = wikidataIds.join('|');
        const wdPath = `/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=sitelinks&sitefilter=trwiki&format=json`;
        
        try {
            const wdData = await this.makeRequest(this.wikidataApi, wdPath);
            const turkishMap = new Map();
            
            if (wdData.entities) {
                for (const wikidataId in wdData.entities) {
                    const entity = wdData.entities[wikidataId];
                    if (entity.sitelinks && entity.sitelinks.trwiki) {
                        const trTitle = entity.sitelinks.trwiki.title.replace('Kategori:', '');
                        turkishMap.set(wikidataId, trTitle);
                    }
                }
            }
            
            return turkishMap;
        } catch (error) {
            console.error('Error checking Turkish equivalents:', error.message);
            return new Map();
        }
    }

    /**
     * Find English categories without Turkish equivalents (using batch processing)
     */
    async findMissingTurkishCategories(enCategory) {
        console.log('\n' + '='.repeat(60));
        console.log(`İngilizce kategori: ${enCategory}`);
        console.log('='.repeat(60) + '\n');

        console.log('İngilizce Vikipedi\'deki alt kategoriler alınıyor...');
        const enCategories = await this.getCategoryMembers(enCategory, 'en');
        const enCategoriesArray = Array.from(enCategories);
        console.log(`Toplam ${enCategoriesArray.length} alt kategori bulundu\n`);

        const missingInTurkish = [];
        const existsInTurkish = [];
        const noWikidata = [];
        
        const BATCH_SIZE = 50;
        const totalBatches = Math.ceil(enCategoriesArray.length / BATCH_SIZE);

        console.log(`Wikidata'da Türkçe karşılıkları kontrol ediliyor (${BATCH_SIZE}'li gruplar halinde)...\n`);

        for (let i = 0; i < enCategoriesArray.length; i += BATCH_SIZE) {
            const batch = enCategoriesArray.slice(i, i + BATCH_SIZE);
            const currentBatch = Math.floor(i / BATCH_SIZE) + 1;
            console.log(`İşleniyor: Grup ${currentBatch}/${totalBatches} (${i + 1}-${Math.min(i + BATCH_SIZE, enCategoriesArray.length)}/${enCategoriesArray.length})`);

            // Step 1: Get Wikidata IDs for this batch
            const wikidataMap = await this.getWikidataIdsBatch(batch);
            
            // Separate categories with and without Wikidata IDs
            const categoriesWithWikidata = [];
            const wikidataIds = [];
            
            for (const category of batch) {
                if (wikidataMap.has(category)) {
                    categoriesWithWikidata.push(category);
                    wikidataIds.push(wikidataMap.get(category));
                } else {
                    noWikidata.push(category);
                }
            }

            // Step 2: Check Turkish equivalents for categories with Wikidata IDs
            if (wikidataIds.length > 0) {
                const turkishMap = await this.checkTurkishEquivalentsBatch(wikidataIds);
                
                for (const category of categoriesWithWikidata) {
                    const wikidataId = wikidataMap.get(category);
                    
                    if (turkishMap.has(wikidataId)) {
                        existsInTurkish.push({
                            english: category,
                            turkish: turkishMap.get(wikidataId),
                            wikidataId: wikidataId
                        });
                    } else {
                        missingInTurkish.push({
                            english: category,
                            wikidataId: wikidataId
                        });
                    }
                }
            }

            // Be polite to the API
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log('\n✅ Kategori kontrolü tamamlandı!\n');

        // Now check subcategories and articles in missing categories (process in batches)
        if (missingInTurkish.length > 0) {
            console.log(`Eksik ${missingInTurkish.length} kategorinin içeriği kontrol ediliyor...\n`);
            
            const CHECK_BATCH_SIZE = 20; // Process 20 categories at a time
            const checkBatches = Math.ceil(missingInTurkish.length / CHECK_BATCH_SIZE);
            const updatedMissingCategories = [];

            for (let i = 0; i < missingInTurkish.length; i += CHECK_BATCH_SIZE) {
                const batch = missingInTurkish.slice(i, i + CHECK_BATCH_SIZE);
                const currentBatch = Math.floor(i / CHECK_BATCH_SIZE) + 1;
                
                console.log(`Alt kategori kontrolü: Grup ${currentBatch}/${checkBatches} (${i + 1}-${Math.min(i + CHECK_BATCH_SIZE, missingInTurkish.length)}/${missingInTurkish.length})`);
                
                // Check subcategories
                const subcategoryResults = await this.checkSubcategoriesForCategoriesBatch(batch);
                
                console.log(`Madde kontrolü: Grup ${currentBatch}/${checkBatches} (${i + 1}-${Math.min(i + CHECK_BATCH_SIZE, missingInTurkish.length)}/${missingInTurkish.length})`);
                
                // Check articles
                const articleResults = await this.checkArticlesForCategoriesBatch(subcategoryResults, 50);
                
                updatedMissingCategories.push(...articleResults);
                
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            console.log('\n✅ İçerik kontrolü tamamlandı!\n');

            return {
                total: enCategoriesArray.length,
                missingInTurkish: updatedMissingCategories.sort((a, b) => {
                    // Sort by total potential content (subcategories + articles with Turkish)
                    const aTotal = (a.subcategoriesWithTurkish || 0) + (a.articlesWithTurkish || 0);
                    const bTotal = (b.subcategoriesWithTurkish || 0) + (b.articlesWithTurkish || 0);
                    return bTotal - aTotal;
                }),
                existsInTurkish: existsInTurkish.sort((a, b) => a.english.localeCompare(b.english)),
                noWikidata: noWikidata.sort()
            };
        }

        return {
            total: enCategoriesArray.length,
            missingInTurkish: missingInTurkish,
            existsInTurkish: existsInTurkish.sort((a, b) => a.english.localeCompare(b.english)),
            noWikidata: noWikidata.sort()
        };
    }
    async getCategoryMembers(categoryName, lang = 'en') {
        const hostname = lang === 'en' ? this.enApi : this.trApi;
        const allCategories = new Set();
        let cmcontinue = null;

        while (true) {
            let path = `/w/api.php?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(categoryName)}&cmtype=subcat&cmlimit=max&format=json`;
            
            if (cmcontinue) {
                path += `&cmcontinue=${encodeURIComponent(cmcontinue)}`;
            }

            try {
                const data = await this.makeRequest(hostname, path);

                if (data.query && data.query.categorymembers) {
                    for (const item of data.query.categorymembers) {
                        // Remove "Category:" or "Kategori:" prefix
                        const catName = item.title
                            .replace('Kategori:', '')
                            .replace('Category:', '');
                        allCategories.add(catName);
                    }
                }

                // Check if there are more results
                if (data.continue && data.continue.cmcontinue) {
                    cmcontinue = data.continue.cmcontinue;
                    // Be polite to the API
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    break;
                }
            } catch (error) {
                console.error(`Error fetching ${lang} categories:`, error.message);
                break;
            }
        }

        return allCategories;
    }

    /**
     * Get all subcategories from a category
     */
    async getCategoryMembers(categoryName, lang = 'en') {
        const hostname = lang === 'en' ? this.enApi : this.trApi;
        const allCategories = new Set();
        let cmcontinue = null;

        while (true) {
            let path = `/w/api.php?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(categoryName)}&cmtype=subcat&cmlimit=max&format=json`;
            
            if (cmcontinue) {
                path += `&cmcontinue=${encodeURIComponent(cmcontinue)}`;
            }

            try {
                const data = await this.makeRequest(hostname, path);

                if (data.query && data.query.categorymembers) {
                    for (const item of data.query.categorymembers) {
                        // Remove "Category:" or "Kategori:" prefix
                        const catName = item.title
                            .replace('Kategori:', '')
                            .replace('Category:', '');
                        allCategories.add(catName);
                    }
                }

                // Check if there are more results
                if (data.continue && data.continue.cmcontinue) {
                    cmcontinue = data.continue.cmcontinue;
                    // Be polite to the API
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    break;
                }
            } catch (error) {
                console.error(`Error fetching ${lang} categories:`, error.message);
                break;
            }
        }

        return allCategories;
    }

    /**
     * Get articles (pages) from a category
     */
    async getCategoryArticles(categoryName, lang = 'en', limit = 100) {
        const hostname = lang === 'en' ? this.enApi : this.trApi;
        const allArticles = [];
        let cmcontinue = null;

        while (allArticles.length < limit) {
            let path = `/w/api.php?action=query&list=categorymembers&cmtitle=Category:${encodeURIComponent(categoryName)}&cmtype=page&cmlimit=max&format=json`;
            
            if (cmcontinue) {
                path += `&cmcontinue=${encodeURIComponent(cmcontinue)}`;
            }

            try {
                const data = await this.makeRequest(hostname, path);

                if (data.query && data.query.categorymembers) {
                    for (const item of data.query.categorymembers) {
                        allArticles.push(item.title);
                        if (allArticles.length >= limit) break;
                    }
                }

                // Check if there are more results
                if (data.continue && data.continue.cmcontinue && allArticles.length < limit) {
                    cmcontinue = data.continue.cmcontinue;
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                    break;
                }
            } catch (error) {
                console.error(`Error fetching ${lang} articles:`, error.message);
                break;
            }
        }

        return allArticles;
    }

    /**
     * Check articles for multiple categories at once (batch processing)
     */
    async checkArticlesForCategoriesBatch(categories, sampleSize = 50) {
        const results = [];
        
        for (const category of categories) {
            try {
                // Get articles from English category
                const articles = await this.getCategoryArticles(category.english, 'en', sampleSize);
                
                if (articles.length === 0) {
                    results.push({
                        ...category,
                        articleCount: 0,
                        articlesWithTurkish: 0,
                        percentage: 0
                    });
                    continue;
                }

                // Get Wikidata IDs for all articles (in batches of 100)
                const BATCH_SIZE = 100;
                let articlesWithTurkish = 0;

                for (let i = 0; i < articles.length; i += BATCH_SIZE) {
                    const batch = articles.slice(i, i + BATCH_SIZE);
                    const titles = batch.join('|');
                    const enPath = `/w/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=pageprops&format=json`;
                    
                    const enData = await this.makeRequest(this.enApi, enPath);
                    const wikidataIds = [];

                    if (enData.query && enData.query.pages) {
                        for (const pageId in enData.query.pages) {
                            const page = enData.query.pages[pageId];
                            if (pageId !== '-1' && page.pageprops && page.pageprops.wikibase_item) {
                                wikidataIds.push(page.pageprops.wikibase_item);
                            }
                        }
                    }

                    // Check Turkish equivalents for these Wikidata IDs
                    if (wikidataIds.length > 0) {
                        const ids = wikidataIds.join('|');
                        const wdPath = `/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=sitelinks&sitefilter=trwiki&format=json`;
                        
                        const wdData = await this.makeRequest(this.wikidataApi, wdPath);
                        
                        if (wdData.entities) {
                            for (const wikidataId in wdData.entities) {
                                const entity = wdData.entities[wikidataId];
                                if (entity.sitelinks && entity.sitelinks.trwiki) {
                                    articlesWithTurkish++;
                                }
                            }
                        }
                    }

                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                results.push({
                    ...category,
                    articleCount: articles.length,
                    articlesWithTurkish: articlesWithTurkish,
                    percentage: Math.round((articlesWithTurkish / articles.length) * 100)
                });

            } catch (error) {
                console.error(`Error checking articles for ${category.english}:`, error.message);
                results.push({
                    ...category,
                    articleCount: 0,
                    articlesWithTurkish: 0,
                    percentage: 0
                });
            }
        }

        return results;
    }

    /**
     * Check subcategories for multiple categories at once (batch processing)
     */
    async checkSubcategoriesForCategoriesBatch(categories) {
        const results = [];
        
        for (const category of categories) {
            try {
                // Get subcategories from English category
                const subcategories = await this.getCategoryMembers(category.english, 'en');
                const subcategoriesArray = Array.from(subcategories);
                
                if (subcategoriesArray.length === 0) {
                    results.push({
                        ...category,
                        subcategoryCount: 0,
                        subcategoriesWithTurkish: 0,
                        subcategoryPercentage: 0
                    });
                    continue;
                }

                // Check which subcategories have Turkish equivalents
                const BATCH_SIZE = 100;
                let subcategoriesWithTurkish = 0;

                for (let i = 0; i < subcategoriesArray.length; i += BATCH_SIZE) {
                    const batch = subcategoriesArray.slice(i, i + BATCH_SIZE);
                    
                    // Get Wikidata IDs for subcategories
                    const wikidataMap = await this.getWikidataIdsBatch(batch);
                    const wikidataIds = Array.from(wikidataMap.values());
                    
                    if (wikidataIds.length > 0) {
                        // Check Turkish equivalents
                        const turkishMap = await this.checkTurkishEquivalentsBatch(wikidataIds);
                        subcategoriesWithTurkish += turkishMap.size;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                results.push({
                    ...category,
                    subcategoryCount: subcategoriesArray.length,
                    subcategoriesWithTurkish: subcategoriesWithTurkish,
                    subcategoryPercentage: Math.round((subcategoriesWithTurkish / subcategoriesArray.length) * 100)
                });

            } catch (error) {
                console.error(`Error checking subcategories for ${category.english}:`, error.message);
                results.push({
                    ...category,
                    subcategoryCount: 0,
                    subcategoriesWithTurkish: 0,
                    subcategoryPercentage: 0
                });
            }
        }

        return results;
    }

    /**
     * Print results
     */
    printResults(results) {
        console.log('\n' + '='.repeat(60));
        console.log('SONUÇLAR');
        console.log('='.repeat(60) + '\n');

        console.log(`📊 İngilizce Vikipedi'deki toplam alt kategori: ${results.total}`);
        console.log(`✅ Türkçe karşılığı var: ${results.existsInTurkish.length}`);
        console.log(`❌ Türkçe karşılığı yok: ${results.missingInTurkish.length}`);
        console.log(`⚠️  Wikidata'da yok: ${results.noWikidata.length}`);

        // Filter categories with potential (at least some subcategories or articles in Turkish)
        const categoriesWithPotential = results.missingInTurkish.filter(item => {
            const totalPotential = (item.subcategoriesWithTurkish || 0) + (item.articlesWithTurkish || 0);
            return totalPotential > 0;
        });

        const categoriesWithoutPotential = results.missingInTurkish.length - categoriesWithPotential.length;

        console.log('\n' + '='.repeat(60));
        console.log('❌ TÜRKÇE VİKİPEDİ\'DE OLMAYAN KATEGORİLER (Potansiyeli Olanlar)');
        console.log('   (İngilizce\'de var, Wikidata\'da Türkçe bağlantısı yok)');
        console.log('='.repeat(60) + '\n');
        
        if (categoriesWithPotential.length > 0) {
            categoriesWithPotential.forEach((item, i) => {
                console.log(`${i + 1}. ${item.english} (${item.wikidataId})`);
                
                // Show subcategory statistics
                if (item.subcategoryCount !== undefined) {
                    if (item.subcategoryCount > 0) {
                        console.log(`   📁 Alt Kategoriler: ${item.subcategoriesWithTurkish}/${item.subcategoryCount} Türkçe'de var (%${item.subcategoryPercentage})`);
                    } else {
                        console.log(`   📁 Alt kategori yok`);
                    }
                }
                
                // Show article statistics
                if (item.articleCount !== undefined) {
                    if (item.articleCount > 0) {
                        console.log(`   📄 Maddeler: ${item.articlesWithTurkish}/${item.articleCount} Türkçe'de var (%${item.percentage})`);
                    } else {
                        console.log(`   📄 Madde yok`);
                    }
                }
                
                // Show total potential
                const totalPotential = (item.subcategoriesWithTurkish || 0) + (item.articlesWithTurkish || 0);
                console.log(`   🎯 Toplam ${totalPotential} potansiyel içerik (${item.subcategoriesWithTurkish || 0} kategori + ${item.articlesWithTurkish || 0} madde)`);
                
                console.log('');
            });
            
            console.log(`✅ ${categoriesWithPotential.length} kategori potansiyel içeriğe sahip`);
            if (categoriesWithoutPotential > 0) {
                console.log(`⚪ ${categoriesWithoutPotential} kategori potansiyelsiz (gizlendi)`);
            }
            
            const totalPotentialCategories = categoriesWithPotential.reduce((sum, item) => 
                sum + (item.subcategoriesWithTurkish || 0), 0
            );
            const totalPotentialArticles = categoriesWithPotential.reduce((sum, item) => 
                sum + (item.articlesWithTurkish || 0), 0
            );
            const totalPotential = totalPotentialCategories + totalPotentialArticles;
            
            console.log(`🎯 Toplam ${totalPotential} potansiyel içerik (${totalPotentialCategories} kategori + ${totalPotentialArticles} madde)`);
        } else {
            console.log('❌ Potansiyeli olan kategori bulunamadı.');
            if (results.missingInTurkish.length > 0) {
                console.log(`\n⚪ ${results.missingInTurkish.length} eksik kategori var ama hiçbirinin Türkçe içeriği yok.`);
            }
        }

        if (results.noWikidata.length > 0) {
            console.log('\n' + '='.repeat(60));
            console.log('⚠️  WİKİDATA\'DA KAYITLI OLMAYAN KATEGORİLER');
            console.log('='.repeat(60) + '\n');
            results.noWikidata.forEach((cat, i) => {
                console.log(`${i + 1}. ${cat}`);
            });
        }
    }
}

/**
 * Main function
 */
async function main() {
    const comparer = new WikipediaCategoryComparer();

    // Komut satırından Türkçe kategori adını al
    const trCategory = process.argv[2];

    if (!trCategory) {
        console.log('\n' + '='.repeat(60));
        console.log('Wikipedia Kategori Karşılaştırma Aracı');
        console.log('='.repeat(60));
        console.log('\nKullanım:');
        console.log('  node wikipedia_compare.js "Kategori Adı"');
        console.log('\nÖrnekler:');
        console.log('  node wikipedia_compare.js "Video oyunları"');
        console.log('  node wikipedia_compare.js "Bilimkurgu"');
        console.log('  node wikipedia_compare.js "Müzik"');
        console.log('  node wikipedia_compare.js "Spor"');
        console.log('\n' + '='.repeat(60) + '\n');
        return;
    }

    try {
        // Find English category from Turkish via Wikidata
        const enCategory = await comparer.getEnglishCategoryFromTurkish(trCategory);
        
        if (!enCategory) {
            console.error('\n❌ Hata: İngilizce karşılık bulunamadı.');
            console.log('Lütfen kategori adını kontrol edin.');
            return;
        }

        // Find categories that exist in English but not in Turkish
        const results = await comparer.findMissingTurkishCategories(enCategory);
        comparer.printResults(results);

        console.log('\n' + '='.repeat(60));
        console.log('✅ Karşılaştırma tamamlandı!');
        console.log('='.repeat(60) + '\n');
    } catch (error) {
        console.error('❌ Karşılaştırma sırasında hata:', error);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = WikipediaCategoryComparer;
