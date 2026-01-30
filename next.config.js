/** @type {import('next').NextConfig} */

// Detect deployment platform
const isVercel = process.env.VERCEL === '1';
const isGitHubPages = process.env.GITHUB_PAGES === '1';

const nextConfig = {
    // Only use static export for GitHub Pages, not Vercel
    ...(isGitHubPages ? { output: 'export' } : {}),
    
    images: {
        unoptimized: true,
    },
    
    // basePath only for GitHub Pages
    basePath: isGitHubPages ? '/C2-cantonese-english-site' : '',
    
    env: {
        NEXT_PUBLIC_BASE_PATH: isGitHubPages ? '/C2-cantonese-english-site' : '',
    },
}

module.exports = nextConfig
