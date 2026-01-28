/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    images: {
        unoptimized: true,
    },
    basePath: process.env.NODE_ENV === 'production' ? '/C2-cantonese-english-site' : '',
    env: {
        NEXT_PUBLIC_BASE_PATH: process.env.NODE_ENV === 'production' ? '/C2-cantonese-english-site' : '',
    },
}

module.exports = nextConfig
