const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const querystring = require('querystring');

class WikiProjectTransferFromTurkish {
    constructor(configPath = './config.json') {
        this.config = null;
        this.configPath = configPath;
        this.enWikiAPI = 'https://en.wikipedia.org/w/api.php';
        this.trWikiAPI = 'https://tr.wikipedia.org/w/api.php';
        this.csrfToken = null;
        this.cookies = '';
    }

    // HTTP request helper
    async makeRequest(url, options = {}) {
        const urlObj = new URL(url);
        
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: options.headers || {}
            }, (res) => {
                let data = '';
                
                // Cookie'leri sakla
                if (res.headers['set-cookie']) {
                    this.cookies = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
                }
                
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                });
            });
            
            req.on('error', reject);
            
            if (options.body) {
                req.write(options.body);
            }
            
            req.end();
        });
    }

    // Config dosyasını yükle
    async loadConfig() {
        try {
            const configData = await fs.readFile(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
            console.log(`✓ Bot hesabı yüklendi: ${this.config.username.split('@')[0]}`);
            return true;
        } catch (error) {
            console.error('Config dosyası yüklenemedi:', error);
            return false;
        }
    }

    // Türkçe madde listesini dosyadan oku
    async loadTurkishArticles(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            const articles = content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'));
            
            console.log(`✓ ${articles.length} Türkçe madde yüklendi`);
            return articles;
        } catch (error) {
            console.error('Madde listesi yüklenemedi:', error);
            return [];
        }
    }

    // Türkçe Wikipedia'ya giriş yap
    async loginToTrWiki() {
        try {
            // Login token al
            const tokenData = await this.makeRequest(
                `${this.trWikiAPI}?action=query&meta=tokens&type=login&format=json`,
                {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'WikiProject Transfer Bot/1.0'
                    }
                }
            );
            
            const loginToken = tokenData.query.tokens.logintoken;

            // Giriş yap
            const loginParams = querystring.stringify({
                action: 'login',
                lgname: this.config.username,
                lgpassword: this.config.password,
                lgtoken: loginToken,
                format: 'json'
            });

            const loginData = await this.makeRequest(this.trWikiAPI, {
                method: 'POST',
                headers: {
                    'User-Agent': 'WikiProject Transfer Bot/1.0',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(loginParams)
                },
                body: loginParams
            });
            
            if (loginData.login && loginData.login.result === 'Success') {
                console.log('✓ Türkçe Wikipedia\'ya giriş başarılı');
                await this.getCsrfToken();
                return true;
            }
            
            console.error('Giriş başarısız:', loginData);
            return false;
        } catch (error) {
            console.error('Giriş hatası:', error);
            return false;
        }
    }

    // CSRF token al
    async getCsrfToken() {
        const data = await this.makeRequest(
            `${this.trWikiAPI}?action=query&meta=tokens&format=json`,
            {
                headers: {
                    'User-Agent': 'WikiProject Transfer Bot/1.0',
                    'Cookie': this.cookies
                }
            }
        );
        this.csrfToken = data.query.tokens.csrftoken;
    }

    // API çağrısı yap
    async apiCall(apiUrl, params) {
        const url = `${apiUrl}?${querystring.stringify(params)}`;
        return await this.makeRequest(url, {
            headers: {
                'User-Agent': 'WikiProject Transfer Bot/1.0',
                'Cookie': this.cookies
            }
        });
    }

    // Türkçe maddeden İngilizce karşılığı bul
    async getEnglishArticle(trTitle) {
        try {
            // Wikidata item'ını bul
            const wdData = await this.apiCall(this.trWikiAPI, {
                action: 'query',
                format: 'json',
                prop: 'pageprops',
                titles: trTitle,
                ppprop: 'wikibase_item'
            });

            const pages = wdData.query.pages;
            const pageId = Object.keys(pages)[0];
            
            if (pageId === '-1' || !pages[pageId].pageprops?.wikibase_item) {
                return null;
            }

            const wikidataId = pages[pageId].pageprops.wikibase_item;

            // Wikidata'dan İngilizce başlığı al
            const wikidataData = await this.apiCall('https://www.wikidata.org/w/api.php', {
                action: 'wbgetentities',
                format: 'json',
                ids: wikidataId,
                props: 'sitelinks',
                sitefilter: 'enwiki'
            });
            
            if (wikidataData.entities[wikidataId]?.sitelinks?.enwiki) {
                return wikidataData.entities[wikidataId].sitelinks.enwiki.title;
            }
        } catch (error) {
            console.error(`Wikidata hatası - ${trTitle}:`, error.message);
        }
        
        return null;
    }

    // İngilizce WikiProject'leri al
    async getEnglishWikiProjects(enTitle) {
        try {
            const data = await this.apiCall(this.enWikiAPI, {
                action: 'query',
                format: 'json',
                prop: 'templates',
                titles: `Talk:${enTitle}`,
                tllimit: '500',
                tlnamespace: '10'
            });

            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            
            if (pageId === '-1' || !pages[pageId]?.templates) {
                return [];
            }

            const wikiprojects = pages[pageId].templates
                .filter(t => 
                    t.title.includes('WikiProject') || 
                    t.title.match(/Template:WP[A-Z]/) ||
                    t.title.includes('WPBIO')
                )
                .map(t => t.title.replace('Template:', '').trim());

            return wikiprojects;
        } catch (error) {
            console.error(`WikiProject alma hatası - ${enTitle}:`, error.message);
            return [];
        }
    }

    // WikiProject'leri Türkçe'ye çevir
    convertToTurkishTemplate(wikiprojects) {
        const projectMappings = {
            // Bilim
            'WikiProject Science': 'Bilim',
            'WikiProject Biology': 'Biyoloji',
            'WikiProject Medicine': 'Tıp',
            'WikiProject Chemistry': 'Kimya',
            'WikiProject Physics': 'Fizik',
            'WikiProject Mathematics': 'Matematik',
            'WikiProject Technology': 'Teknoloji',
            'WikiProject Computer science': 'Bilgisayar',
            'WikiProject Astronomy': 'Astronomi',
            'WikiProject History of Science': 'Bilim tarihi',
            
            // Kişiler
            'WikiProject Biography': 'Biyografi',
            'WPBIO': 'Biyografi',
            'WPBiography': 'Biyografi',
            
            // Coğrafya
            'WikiProject Geography': 'Coğrafya',
            'WikiProject Cities': 'Yerleşim',
            'WikiProject Countries': 'Ülkeler',
            'WikiProject Turkey': 'Türkiye',
            
            // Tarih
            'WikiProject History': 'Tarih',
            'WikiProject Military history': 'Askeri tarih',
            
            // Sanat
            'WikiProject Film': 'Film',
            'WikiProject Music': 'Müzik',
            'WikiProject Literature': 'Edebiyat',
            
            // Spor
            'WikiProject Football': 'Futbol',
            'WikiProject Sports': 'Spor',
            
            // Diğer
            'WikiProject Politics': 'Siyaset',
            'WikiProject Religion': 'Din',
            'WikiProject Philosophy': 'Felsefe',
            'WikiProject Education': 'Eğitim',
            'WikiProject Companies': 'Şirketler'
        };

        const foundProjects = new Set();
        
        for (const wp of wikiprojects) {
            const cleanName = wp.replace('Template:', '').trim();
            
            if (projectMappings[cleanName]) {
                foundProjects.add(projectMappings[cleanName]);
            } else {
                for (const [engProject, trProject] of Object.entries(projectMappings)) {
                    if (cleanName.toLowerCase().includes(engProject.toLowerCase().replace('WikiProject ', ''))) {
                        foundProjects.add(trProject);
                        break;
                    }
                }
            }
        }

        if (foundProjects.size === 0) {
            return [];
        }

        return Array.from(foundProjects).map(project => 
            `{{Vikiproje|Proje=${project}|sınıf=|önem=}}`
        );
    }

    // Türkçe tartışma sayfasını kontrol
    async checkTurkishTalkPage(title) {
        const data = await this.apiCall(this.trWikiAPI, {
            action: 'query',
            format: 'json',
            prop: 'revisions',
            titles: `Tartışma:${title}`,
            rvprop: 'content',
            rvlimit: '1'
        });

        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        
        if (pageId === '-1') {
            return { exists: false, hasWikiProject: false, content: '' };
        }

        const content = pages[pageId].revisions?.[0]?.['*'] || '';
        const hasWikiProject = content.includes('Vikiproje') || content.includes('vikiproje');
        
        return { exists: true, hasWikiProject, content };
    }

    // Tartışma sayfasına WikiProject ekle
    async addWikiProjectToTurkish(trTitle, turkishTemplates) {
        try {
            const talkPageTitle = `Tartışma:${trTitle}`;
            const { exists, hasWikiProject, content } = await this.checkTurkishTalkPage(trTitle);

            if (hasWikiProject) {
                console.log(`  ⚠ Zaten Vikiproje mevcut`);
                return { success: true, skipped: true };
            }

            let newContent = exists && content
                ? turkishTemplates.join('\n') + '\n\n' + content
                : turkishTemplates.join('\n');

            const editParams = querystring.stringify({
                action: 'edit',
                title: talkPageTitle,
                text: newContent,
                summary: 'Vikiproje şablonları eklendi',
                bot: 'true',
                token: this.csrfToken,
                format: 'json'
            });

            const editData = await this.makeRequest(this.trWikiAPI, {
                method: 'POST',
                headers: {
                    'User-Agent': 'WikiProject Transfer Bot/1.0',
                    'Cookie': this.cookies,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(editParams)
                },
                body: editParams
            });
            
            if (editData.edit?.result === 'Success') {
                console.log(`  ✓ Vikiproje eklendi`);
                return { success: true, skipped: false };
            } else {
                console.error(`  ✗ Hata:`, editData.error?.info || 'Bilinmeyen');
                return { success: false, error: editData.error };
            }
        } catch (error) {
            console.error(`  ✗ Hata:`, error.message);
            return { success: false, error: error.message };
        }
    }

    // Ana işlem
    async processArticles(articleListFile, testMode = false) {
        console.log('\n════════════════════════════════════════');
        console.log('   WikiProject Transfer Bot (TR→EN→TR)');
        console.log('════════════════════════════════════════\n');
        
        if (!await this.loadConfig()) {
            console.error('Config yüklenemedi!');
            return;
        }

        const turkishArticles = await this.loadTurkishArticles(articleListFile);
        if (turkishArticles.length === 0) {
            console.error('Madde listesi boş!');
            return;
        }

        if (!testMode && !await this.loginToTrWiki()) {
            console.error('Giriş yapılamadı!');
            return;
        }

        const results = {
            processed: 0,
            added: 0,
            skipped: 0,
            noEnglish: 0,
            noWikiProject: 0,
            errors: 0
        };

        const logEntries = [];
        const startTime = Date.now();

        console.log('\n▼ İşlem Başlıyor ▼\n');

        for (let i = 0; i < turkishArticles.length; i++) {
            const trTitle = turkishArticles[i];
            console.log(`\n[${i+1}/${turkishArticles.length}] ${trTitle}`);
            
            const enTitle = await this.getEnglishArticle(trTitle);
            
            if (!enTitle) {
                console.log(`  ✗ İngilizce karşılık yok`);
                results.noEnglish++;
                logEntries.push({
                    tr: trTitle,
                    en: null,
                    status: 'no_english'
                });
                continue;
            }

            console.log(`  → İngilizce: ${enTitle}`);

            const enWikiProjects = await this.getEnglishWikiProjects(enTitle);
            
            if (enWikiProjects.length === 0) {
                console.log(`  ✗ WikiProject yok`);
                results.noWikiProject++;
                logEntries.push({
                    tr: trTitle,
                    en: enTitle,
                    status: 'no_wikiproject'
                });
                continue;
            }

            console.log(`  → WikiProjects: ${enWikiProjects.slice(0, 3).join(', ')}`);

            const turkishTemplates = this.convertToTurkishTemplate(enWikiProjects);
            
            if (turkishTemplates.length === 0) {
                console.log(`  ⚠ Türkçe şablon yok`);
                results.noWikiProject++;
                continue;
            }

            if (testMode) {
                console.log('  [TEST] Eklenecek:');
                turkishTemplates.forEach(t => console.log(`    ${t}`));
                results.skipped++;
            } else {
                const result = await this.addWikiProjectToTurkish(trTitle, turkishTemplates);
                results.processed++;
                
                if (result.success) {
                    result.skipped ? results.skipped++ : results.added++;
                } else {
                    results.errors++;
                }
            }

            logEntries.push({
                tr: trTitle,
                en: enTitle,
                enWikiProjects,
                turkishTemplates,
                status: testMode ? 'test' : (results.added ? 'added' : 'skipped')
            });

            if (!testMode && i < turkishArticles.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        const logFile = `wikiproject_log_${Date.now()}.json`;
        await fs.writeFile(logFile, JSON.stringify({
            summary: results,
            entries: logEntries
        }, null, 2));

        console.log('\n════════════════════════════════════════');
        console.log('             ÖZET');
        console.log('════════════════════════════════════════');
        console.log(`İşlenen:         ${results.processed}`);
        console.log(`Eklenen:         ${results.added} ✓`);
        console.log(`Atlanan:         ${results.skipped} ⚠`);
        console.log(`İng. yok:        ${results.noEnglish} ✗`);
        console.log(`WikiProject yok: ${results.noWikiProject} ✗`);
        console.log(`Hatalar:         ${results.errors} ✗`);
        console.log(`Log: ${logFile}`);
        console.log('════════════════════════════════════════\n');
    }
}

// Ana fonksiyon
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Kullanım: node vikiproje.js <dosya> [--test]');
        
        await fs.writeFile('maddeler.txt', 
`Albert Einstein
Marie Curie
Nikola Tesla
İstanbul
Ankara`);
        
        console.log('\nmaddeler.txt oluşturuldu.');
        console.log('node vikiproje.js maddeler.txt --test');
        return;
    }

    const file = args[0];
    const testMode = args.includes('--test');
    
    if (testMode) {
        console.log('🔧 TEST MODU\n');
    }

    const bot = new WikiProjectTransferFromTurkish('./config.json');
    await bot.processArticles(file, testMode);
}

main().catch(console.error);