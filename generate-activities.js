// fetch-urls.js
// import { fileURLToPath } from 'url';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import fetch from 'node-fetch';
import process from 'process';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Get GitHub token from environment variable
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
    console.error('❌ Error: GITHUB_TOKEN environment variable is not set');
    console.log('Please set your GitHub token first:');
    console.log('export GITHUB_TOKEN=your_token_here');
    process.exit(1);
}

// Configuration - you can also load this from a config file
const CONFIG = {
    urls: [
        'https://api.github.com/repos/digital-blueprint/cabinet-app/contents/assets/dbp-cabinet.topic.metadata.json.ejs',
        'https://api.github.com/repos/digital-blueprint/dispatch-app/contents/assets/dbp-dispatch.topic.metadata.json.ejs',
        // Esign must be after dispatch and cabinet! Otherwise we try to get the activity from the wrong application git repo.
        'https://api.github.com/repos/digital-blueprint/esign-app/contents/assets/dbp-signature.topic.metadata.json.ejs',
        'https://api.github.com/repos/digital-blueprint/formalize-app/contents/assets/dbp-formalize.topic.metadata.json.ejs',
        /* LunchLottery has special place and file-name for the topic metadata */
        'https://api.github.com/repos/digital-blueprint/lunchlottery-app/contents/src/dbp-lunchlottery-app.topic.metadata.json',
        /* Also special place for topic metadata */
        // 'https://api.github.com/repos/digital-blueprint/activities/contents/activity-showcase/assets/dbp-activity-showcase.topic.metadata.json.ejs',
        /*'https://api.github.com/repos/digital-blueprint/check-app/contents/assets/dbp-check.topic.metadata.json.ejs',*/
    ],
    dataOutputDir: 'typesense-data',
    topicJsonOutputDir: 'assets',
    fetchOptions: {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    }
};

/**
 * Fetches data from multiple URLs and combines results into a single object
 * @param {string[]} urls - Array of URLs to fetch from
 * @param {boolean} topic - Are we looking for topics metadata or not
 * @param {object} options - Optional fetch configuration
 * @returns {Promise<object>} Combined results from all URLs
 */
async function fetchFromUrls(urls, topic = true, options = {}) {
    // Input validation
    if (!Array.isArray(urls)) {
        throw new Error('URLs parameter must be an array');
    }

    // Configure default options
    const fetchOptions = {
        timeout: 5000,
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Node.js URL Fetcher'
        },
        ...options
    };

    const results = {};

    try {
        let jsonsFiles = [];
        for (const url of urls) {
            try {
                // let results = [];
                const response = await fetch(url, fetchOptions);

                if (!response.ok) {
                    results[url] = {
                        error: `HTTP error! status: ${response.status}`,
                        status: 'failed'
                    };
                    continue;
                }

                const data = await response.json();
                // Process response
                const fileContent = data['content'];
                const fileContentEncoding = data['encoding'];
                let appGitUrl;
                let appName;
                if (topic) {
                    appName = data['name'].replace(/\.topic\.metadata\.json.*$/, '');
                    let re = new RegExp(String.raw`(assets|src)\/${appName}\.topic\.metadata\.json.*$`, "g");
                    appGitUrl = data['url'].replace(re, '');
                } else {
                    appName = data['name'].replace(/\.metadata\.json.*$/, '');
                    let re = new RegExp(String.raw`(assets|src)\/${appName}\.metadata\.json.*$`, "g");
                    appGitUrl = data['url'].replace(re, '');
                }
                if (fileContentEncoding == 'base64') {
                    // Decode base64 and parse as JSON
                    let decodedContent = atob(fileContent);

                    if (topic) {
                        // Remove visibility property from topic json. (only in esign)
                        decodedContent = decodedContent.replace(/,\n\s+"visible":.*\}/g, '}');
                    }
                    console.log(decodedContent);
                    try {
                        // Parse the JSON string into an object
                        const jsonContent = JSON.parse(decodedContent);
                        jsonContent['appName'] = appName;
                        jsonContent['appGitUrl'] = appGitUrl;
                        jsonsFiles.push(jsonContent);
                    } catch (parseError) {
                        jsonsFiles.push({
                            error: `JSON parsing error: ${parseError.message}`,
                            status: 'failed'
                        });
                    }
                }
            } catch (error) {
                results[url] = {
                    error: error.message,
                    status: 'failed'
                };
            }
        }
        return {
            success: true,
            timestamp: new Date().toISOString(),
            results: jsonsFiles
        };
    } catch (error) {
        return {
            success: false,
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

async function generateTypesenseImportFile(activityJsons) {
    console.log(activityJsons);
    /*
    {
        element: "dbp-cabinet-search",
        module_src: "dbp-cabinet-search.js",
        routing_name: "cabinet-search",
        name: {
        de: "Studierendenakten verwalten",
        en: "Manage student records",
        },
        short_name: {
        de: "Studierendenakten verwalten",
        en: "Manage student records",
        },
        description: {
        de: "Elektronische Studierendenakten durchsuchen und bearbeiten.",
        en: "Search and edit records of applicants and students.",
        },
        subscribe: "lang,lang-dir,entry-point-url,auth,html-overrides,nextcloud-web-app-password-url,nextcloud-webdav-url,nextcloud-name,nextcloud-file-url,file-handling-enabled-targets,typesense-host,typesense-key,typesense-collection,typesense-protocol,typesense-port,typesense-path,base-path",
        appName: "dbp-cabinet-search.metadata.json",
        appGitUrl: "https://api.github.com/repos/digital-blueprint/cabinet-app/contents/src/dbp-cabinet-search.metadata.json?ref=main",
    }
    */
    const typesenseDocuments = [];
    activityJsons.forEach((result) => {
        const activity = result.results[0];
        const typesenseDocument = {
            activityName: activity.name.en,
            activityPath: activity.appName,
            activityDescription: activity.description.en,
            activityRoutingName: activity.routing_name,
            activityModuleSrc: activity.module_src,
            activityTag: ["pdf", "signature"],
            activityIcon: activity.routing_name + '-icon'
        };
        typesenseDocuments.push(typesenseDocument);
    });

    if (typesenseDocuments.length > 0) {
        return JSON.stringify(typesenseDocuments);
    }
    return false;
}

async function main() {
    try {
        // Create output directory if it doesn't exist
        await mkdir(CONFIG.dataOutputDir, { recursive: true });

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `fetch-results-${timestamp}.json`;
        const typeSenseOutputPath = join(CONFIG.dataOutputDir, filename);

        console.log('🚀 Starting URL fetch...');
        console.log(`📜 URLs to fetch: ${CONFIG.urls.length}`);

        // Fetch the data
        const topicsResults = await fetchFromUrls(CONFIG.urls, CONFIG.fetchOptions);

        console.log('results', topicsResults.results);

        // Initialize a Map to store unique activities
        const uniqueActivitiesMap = new Map();

        // Loop through the results and collect unique activities
        for (const result of topicsResults.results) {
            if (result && result.activities && Array.isArray(result.activities)) {
                result.activities.forEach(activity => {
                    activity.app_name = result.appName;
                    activity.app_git_url = result.appGitUrl;
                    // Use the activity as the key in the Map to ensure uniqueness
                    uniqueActivitiesMap.set(activity.path, activity);
                });
            }
        }
        const uniqueActivitiesArray = Array.from(uniqueActivitiesMap.values());
        console.log('uniqueActivitiesArray', uniqueActivitiesArray);


        let activityJsons = [];
        for (const activity of uniqueActivitiesArray) {
            // First try to find activity metadata jsons in the src directory
            const activityJsonSrcFileUrl = activity.app_git_url + 'src/' + activity.path;
            let activitiesResults = await fetchFromUrls([activityJsonSrcFileUrl], CONFIG.fetchOptions);

            // If no success try in the assets directory
            if (!activitiesResults.success || activitiesResults.results.length < 1) {
                const activityJsonAssetsFileUrl = activity.app_git_url + 'assets/' + activity.path;
                activitiesResults = await fetchFromUrls([activityJsonAssetsFileUrl], CONFIG.fetchOptions);
            }
            if (activitiesResults.results.length > 0) {
                activityJsons.push(activitiesResults);
            }
        }

        const typeSenseImportFile = await generateTypesenseImportFile(activityJsons);
        if (typeSenseImportFile) {
            // Write typesense json results activities to file
            await writeFile(
                typeSenseOutputPath,
                typeSenseImportFile,
                'utf8'
            );
        }

        console.log('✅ Fetch completed successfully');
        console.log(`📁 Results saved to: ${typeSenseOutputPath}`);

        // Print summary
        const successCount = Object.values(topicsResults.results).filter(
            r => !r.error
        ).length;
        console.log(`📊 Summary: ${successCount}/${CONFIG.urls.length} successful`);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();