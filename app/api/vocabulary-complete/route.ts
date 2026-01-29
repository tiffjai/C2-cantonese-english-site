export const dynamic = 'force-static'

import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
    const filePath = path.join(process.cwd(), 'vocabulary_complete.md')
    try {
        const text = await readFile(filePath, 'utf-8')
        return NextResponse.json({ text })
    } catch (err) {
        return NextResponse.json({ error: 'cannot read vocabulary_complete.md', detail: String(err) }, { status: 500 })
    }
}
