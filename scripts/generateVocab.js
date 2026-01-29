// Parse vocabulary_extracted.md into public/vocab.json for static use.
// Run: node scripts/generateVocab.js

import { promises as fs } from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'vocabulary_complete.md')
const OUT = path.join(process.cwd(), 'public', 'vocab.json')

const heading = /^###\s+(\d+)\.\s+(.+?)\s+\[([^\]]+)\]/ // ### 001. humanitarian [ipa]
const senseLine = /^-\s+\*\*(.+?)\*\*\s+(.+)/ // - **名** text
const exampleLine = /^-\s*\*例句\*:\s*(.+)/
const relatedLine = /^-\s*\*\*相關詞彙\*\*:\s*(.+)/

async function main() {
    const raw = await fs.readFile(SRC, 'utf-8')
    const lines = raw.split('\n')
    const entries = []
    let current = null

    for (const line of lines) {
        const h = heading.exec(line)
        if (h) {
            if (current) entries.push(current)
            current = {
                id: Number(h[1]),
                word: h[2].trim(),
                ipa: h[3].trim(),
                senses: [],
                examples: [],
                related: [],
            }
            continue
        }
        if (!current) continue

        const s = senseLine.exec(line)
        if (s) {
            current.senses.push({ pos: s[1].trim(), zh: s[2].trim() })
            continue
        }
        const ex = exampleLine.exec(line)
        if (ex) {
            current.examples.push(ex[1].trim())
            continue
        }
        const rel = relatedLine.exec(line)
        if (rel) {
            current.related = rel[1]
                .split('|')
                .map((r) => r.replace(/^[^A-Za-z\u4e00-\u9fff]+/, '').trim())
                .filter(Boolean)
            continue
        }
    }
    if (current) entries.push(current)

    await fs.mkdir(path.dirname(OUT), { recursive: true })
    await fs.writeFile(OUT, JSON.stringify({ items: entries }, null, 2), 'utf-8')
    console.log(`Wrote ${entries.length} entries to ${OUT}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
