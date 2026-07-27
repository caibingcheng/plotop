import * as https from 'https';

export interface ReleaseInfo {
  tag: string;
  version: string;
  url: string;
}

export const SERVER_PROTOCOL_VERSION = 1;
export const MIN_CLIENT_PROTOCOL_VERSION = 1;

interface CachedEntry {
  info: ReleaseInfo;
  timestamp: number;
}

let cachedRelease: CachedEntry | null = null;
const CACHE_TTL = 5 * 60 * 1000;

function parseVersion(version: string): number[] {
  const base = version.split('-')[0].split('+')[0];
  return base.split('.').map((part) => parseInt(part, 10));
}

function fetchLatestReleaseFromGitHub(): Promise<ReleaseInfo> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      'https://api.github.com/repos/caibingcheng/plotop/releases/latest',
      {
        headers: {
          'User-Agent': 'plotop-version-check',
          Accept: 'application/vnd.github+json',
        },
        timeout: 10000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${response.statusCode}`));
          return;
        }
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            const tag = String(json.tag_name || '');
            const url = String(json.html_url || '');
            const version = tag.replace(/^v/i, '');
            if (!version) {
              reject(new Error('No release tag found'));
              return;
            }
            resolve({ tag, version, url });
          } catch {
            reject(new Error('Failed to parse release data'));
          }
        });
      }
    );
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

export function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
}

export async function getLatestRelease(): Promise<ReleaseInfo | null> {
  if (cachedRelease && Date.now() - cachedRelease.timestamp < CACHE_TTL) {
    return cachedRelease.info;
  }
  try {
    const info = await fetchLatestReleaseFromGitHub();
    cachedRelease = { info, timestamp: Date.now() };
    return info;
  } catch {
    return null;
  }
}

export function getCachedRelease(): ReleaseInfo | null {
  if (cachedRelease && Date.now() - cachedRelease.timestamp < CACHE_TTL) {
    return cachedRelease.info;
  }
  return null;
}
