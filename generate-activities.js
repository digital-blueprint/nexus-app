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
    // or on Windows:
    // console.log('set GITHUB_TOKEN=your_token_here');
    process.exit(1);
}

// Configuration - you can also load this from a config file
const CONFIG = {
    urls: [
        /* Don't get valid json, need to debug (dispatch has this activities) */
        /*'https://api.github.com/repos/digital-blueprint/esign-app/contents/assets/dbp-signature.topic.metadata.json.ejs',*/
        /*'https://api.github.com/repos/digital-blueprint/check-app/contents/assets/dbp-check.topic.metadata.json.ejs',*/
        'https://api.github.com/repos/digital-blueprint/cabinet-app/contents/assets/dbp-cabinet.topic.metadata.json.ejs',
        'https://api.github.com/repos/digital-blueprint/dispatch-app/contents/assets/dbp-dispatch.topic.metadata.json.ejs',
        'https://api.github.com/repos/digital-blueprint/formalize-app/contents/assets/dbp-formalize.topic.metadata.json.ejs',
        /* LunchLottery has special place and file-name for the topic metadata */
        'https://api.github.com/repos/digital-blueprint/lunchlottery-app/contents/src/dbp-lunchlottery-app.topic.metadata.json',
        /* Also special place for topic metadata */
        /*'https://api.github.com/repos/digital-blueprint/activities/contents/activity-showcase/assets/dbp-activity-showcase.topic.metadata.json.ejs',*/
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
 * @param {object} options - Optional fetch configuration
 * @returns {Promise<object>} Combined results from all URLs
 */
async function fetchFromUrls(urls, options = {}) {
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
        let topicJsons = [];
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
                if (fileContentEncoding == 'base64') {
                    // Decode base64 and parse as JSON
                    const decodedContent = atob(fileContent);
                    try {
                        // Parse the JSON string into an object
                        const jsonContent = JSON.parse(decodedContent);
                        // results[url] = jsonContent; // Store the parsed JSON object
                        topicJsons.push(jsonContent);
                    } catch (parseError) {
                        // results[url] = {
                        //     error: `JSON parsing error: ${parseError.message}`,
                        //     status: 'failed'
                        // };
                        topicJsons.push({
                            error: `JSON parsing error: ${parseError.message}`,
                            status: 'failed'
                        });
                    }
                }
                // console.log('topicJson', topicJson);
                // results[url] = topicJson.trim();
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
            results: topicJsons
        };
    } catch (error) {
        return {
            success: false,
            timestamp: new Date().toISOString(),
            error: error.message
        };
    }
}

async function main() {
    try {
        // Create output directory if it doesn't exist
        await mkdir(CONFIG.dataOutputDir, { recursive: true });

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `fetch-results-${timestamp}.json`;
        const typeSenseOutputPath = join(CONFIG.dataOutputDir, filename);
        const topicFilename = 'dbp-nexus.topic.metadata.json.ejs';
        const nexusTopicJsonOutputPath = join(CONFIG.topicJsonOutputDir, topicFilename);

        console.log('🚀 Starting URL fetch...');
        console.log(`📜 URLs to fetch: ${CONFIG.urls.length}`);

        // Fetch the data
        const results = await fetchFromUrls(CONFIG.urls, CONFIG.fetchOptions);

        console.log('results', results.results);

        // Initialize a Map to store unique activities
        const uniqueActivitiesMap = new Map();

        // Loop through the results and collect unique activities
        for (const result of results.results) {
            if (result && result.activities && Array.isArray(result.activities)) {
                result.activities.forEach(activity => {
                    console.log('Map key', activity);
                    // Use the activity as the key in the Map to ensure uniqueness
                    uniqueActivitiesMap.set(activity.path, activity);
                });
            }
        }
        const uniqueActivitiesArray = Array.from(uniqueActivitiesMap.values());
        console.log('uniqueActivitiesArray', uniqueActivitiesArray);
        const nexusTopicJson = `{
            "name": {
                "de": "Nexus",
                "en": "Nexus"
            },
            "short_name": {
                "de": "Nexus-Aktivitätensuche",
                "en": "Nexus Activity Finder"
            },
            "description": {
                "de": "Diese Anwendung ermöglicht es Ihnen, nach DBP-Aktivitäten zu suchen.",
                "en": "This application enables you to search DBP activities."
            },
            "routing_name": "nexus",
            "activities": [
                ${uniqueActivitiesArray.map(obj => JSON.stringify(obj)).join(",\n ")}
            ],
            "attributes": []
            }
        `;
        console.log('nexusTopicJson', nexusTopicJson);
        // Write dbp-nexus.topic.metadata.json.ejs
        await writeFile(
            nexusTopicJsonOutputPath,
            nexusTopicJson,
            'utf8'
        );

        //@TODO we need to fetch all activity json file to create the typesense json data file.

        // Write typesense json results activities to file
        await writeFile(
            typeSenseOutputPath,
            JSON.stringify(results.results, null, 2),
            'utf8'
        );

        console.log('✅ Fetch completed successfully');
        console.log(`📁 Results saved to: ${typeSenseOutputPath}`);

        // Print summary
        const successCount = Object.values(results.results).filter(
            r => !r.error
        ).length;
        console.log(`📊 Summary: ${successCount}/${CONFIG.urls.length} successful`);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();