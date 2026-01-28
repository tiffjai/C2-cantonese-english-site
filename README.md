# 粵語英文詞彙學習應用程式 | Cantonese-English Vocabulary Learning App

一個使用粵語作為主要介面語言的互動式英語詞彙學習應用程式，涵蓋 A1 至 C2 所有 CEFR 級別。

An interactive English vocabulary learning app with Cantonese as the primary interface language, covering all CEFR levels from A1 to C2.

## ✨ 功能特點 | Features

- 📚 **閃卡學習模式** - 翻轉卡片學習超過 9,900 個英語單詞
- ✅ **測驗模式** - 多項選擇題測試您的詞彙掌握程度
- 📊 **進度追蹤** - 記錄學習統計和測驗成績
- 🎯 **級別選擇** - 支持 A1、A2、B1、B2、C1、C2 六個級別
- 🌙 **深色模式** - 支持深色/淺色主題切換
- 💾 **本地儲存** - 自動保存學習進度

## 🚀 技術棧 | Tech Stack

- **框架**: Next.js 14+ (App Router)
- **語言**: TypeScript
- **樣式**: Vanilla CSS with modern design
- **狀態管理**: React Context API + localStorage
- **數據**: CSV (9,937 words from CEFR wordlist)

## 📦 安裝 | Installation

```bash
# 克隆倉庫
git clone https://github.com/tiffjai/C2-cantonese-english-site.git

# 進入目錄
cd C2-cantonese-english-site

# 安裝依賴
npm install

# 啟動開發服務器
npm run dev
```

訪問 [http://localhost:3000](http://localhost:3000) 查看應用程式。

## 🏗️ 構建 | Build

```bash
# 構建生產版本
npm run build

# 啟動生產服務器
npm start
```

## 📁 項目結構 | Project Structure

```
C2-cantonese-english-site/
├── app/                    # Next.js App Router pages
│   ├── flashcards/        # 閃卡學習頁面
│   ├── quiz/              # 測驗頁面
│   ├── progress/          # 進度追蹤頁面
│   ├── layout.tsx         # 根佈局
│   ├── page.tsx           # 主頁
│   └── globals.css        # 全局樣式
├── components/            # React 組件
│   ├── Flashcard.tsx      # 閃卡組件
│   └── Navigation.tsx     # 導航組件
├── contexts/              # React Context
│   ├── ThemeContext.tsx   # 主題管理
│   └── ProgressContext.tsx # 進度管理
├── lib/                   # 工具函數
│   ├── types.ts           # TypeScript 類型定義
│   ├── csvParser.ts       # CSV 解析器
│   └── quizGenerator.ts   # 測驗生成器
└── public/                # 靜態資源
    └── ENGLISH_CERF_WORDS.csv  # 詞彙數據
```

## 🎨 設計特點 | Design Features

- **現代化設計系統** - 使用 CSS 變量和漸變色
- **玻璃態效果** - Glassmorphism 設計風格
- **流暢動畫** - 3D 翻轉卡片和過渡效果
- **響應式佈局** - 支持手機、平板和桌面設備
- **粵語字體** - 使用 Noto Sans HK 字體

## 📊 數據來源 | Data Source

詞彙數據來自 CEFR (Common European Framework of Reference for Languages) 官方詞彙表，包含：

- **A1**: 初級入門詞彙
- **A2**: 初級進階詞彙
- **B1**: 中級基礎詞彙
- **B2**: 中級進階詞彙
- **C1**: 高級基礎詞彙
- **C2**: 高級精通詞彙

## 🔮 未來計劃 | Future Plans

- [ ] 添加粵語翻譯和例句
- [ ] 實現間隔重複算法 (Spaced Repetition)
- [ ] 添加發音功能 (Text-to-Speech)
- [ ] 支持自定義詞彙列表
- [ ] 添加成就系統和徽章
- [ ] 多用戶支持和雲端同步

## 📝 許可證 | License

ISC

## 👨‍💻 作者 | Author

Built with ❤️ using Next.js and TypeScript

---

**開始學習 C2 級別英語詞彙！** 🚀
