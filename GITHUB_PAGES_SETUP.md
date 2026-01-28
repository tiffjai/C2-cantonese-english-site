# 🚀 GitHub Pages 部署步驟

## ✅ 已完成
- [x] GitHub Actions 工作流程已創建
- [x] 部署配置已推送到 GitHub
- [x] 所有代碼已同步

## 📋 下一步：啟用 GitHub Pages

### 步驟 1: 前往 GitHub 倉庫設置

1. 打開瀏覽器，訪問: **https://github.com/tiffjai/C2-cantonese-english-site**
2. 點擊頂部的 **Settings** (設置) 標籤

### 步驟 2: 配置 GitHub Pages

1. 在左側菜單中，向下滾動找到 **Pages** 選項
2. 點擊 **Pages**
3. 在 **Build and deployment** 部分:
   - **Source**: 選擇 **GitHub Actions** (不是 Deploy from a branch)
4. 無需其他設置，GitHub Actions 會自動處理

### 步驟 3: 觸發首次部署

有兩種方式觸發部署:

**方式 A: 自動觸發（推薦）**
- 部署會在您保存 Pages 設置後自動開始
- 或者對倉庫進行任何推送都會觸發部署

**方式 B: 手動觸發**
1. 前往倉庫的 **Actions** 標籤
2. 在左側選擇 **Deploy to GitHub Pages** 工作流程
3. 點擊右側的 **Run workflow** 按鈕
4. 選擇 `main` 分支
5. 點擊綠色的 **Run workflow** 按鈕

### 步驟 4: 監控部署進度

1. 在 **Actions** 標籤中，您會看到一個新的工作流程運行
2. 點擊它查看詳細進度
3. 等待所有步驟完成（通常 2-3 分鐘）:
   - ✅ build (構建)
   - ✅ deploy (部署)

### 步驟 5: 訪問您的網站

部署成功後，您的網站將在以下地址上線:

```
https://tiffjai.github.io/C2-cantonese-english-site/
```

## 🎯 驗證清單

訪問網站後，確認以下功能正常:

- [ ] 主頁顯示正確
- [ ] 可以點擊級別卡片（A1-C2）
- [ ] 閃卡頁面可以翻轉卡片
- [ ] 測驗頁面可以選擇答案
- [ ] 進度頁面顯示統計
- [ ] 深色/淺色模式切換正常
- [ ] 導航菜單工作正常
- [ ] 在手機上顯示正常（響應式）

## 🔧 如果遇到問題

### 問題 1: Actions 標籤中沒有工作流程
**解決方案**: 
- 確認您已推送 `.github/workflows/deploy.yml` 文件
- 運行 `git log --oneline -1` 確認最新提交包含工作流程

### 問題 2: 部署失敗
**解決方案**:
1. 點擊失敗的工作流程查看錯誤日誌
2. 常見問題:
   - 權限不足: 在 Settings → Actions → General 中啟用 "Read and write permissions"
   - 構建錯誤: 檢查 `npm run build` 是否在本地成功

### 問題 3: 網站顯示 404
**解決方案**:
- 確認 GitHub Pages Source 設置為 "GitHub Actions"
- 等待幾分鐘讓 DNS 傳播
- 清除瀏覽器緩存

### 問題 4: 樣式未加載
**解決方案**:
- 確認 URL 包含 `/C2-cantonese-english-site/`
- 檢查瀏覽器控制台的錯誤信息
- 確認 `next.config.js` 中的 `basePath` 設置正確

## 📱 測試建議

### 桌面測試
- Chrome / Edge
- Firefox
- Safari

### 移動測試
- 在手機瀏覽器中打開
- 測試觸摸交互
- 測試橫屏/豎屏模式

## 🎉 完成！

一旦部署成功，您就擁有了一個完全功能的線上英語學習應用程式！

**網站地址**: https://tiffjai.github.io/C2-cantonese-english-site/

---

## 📚 相關文檔

- [DEPLOYMENT.md](./DEPLOYMENT.md) - 詳細部署指南
- [README.md](./README.md) - 項目文檔
- [GitHub Actions 工作流程](./.github/workflows/deploy.yml) - 自動部署配置

## 🔄 未來更新

要更新網站:
1. 修改代碼
2. `git add .`
3. `git commit -m "描述更改"`
4. `git push origin main`
5. GitHub Actions 會自動重新部署！

---

**需要幫助？** 查看 [DEPLOYMENT.md](./DEPLOYMENT.md) 獲取更多詳細信息。
