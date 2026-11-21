# AUTOTRADE 10 — Paper Trading (Gate USDT-M Futures)

Paper only. Tidak ada API key, tidak ada order sungguhan. Data dari endpoint publik Gate:
contracts, tickers, order_book, candlesticks.

## Jalankan lokal (Windows/PowerShell, Node 18+)
    cd autotrade10
    node server.js
Buka http://localhost:8787 → Start. Tab harus tetap terbuka, komputer jangan sleep.

## Deploy ke Vercel
    npm i -g vercel
    cd autotrade10
    vercel --prod
`api/gate.js` = proxy read-only (4 endpoint publik, parameter divalidasi). Region default `sin1` (vercel.json).

## File
- index.html — engine + UI (satu file)
- api/_proxy.js — logika proxy (allowlist)
- api/gate.js — Vercel function
- server.js — server lokal tanpa dependency
- tests/ — unit, E2E (mock Gate + verifikasi independen tiap trade), UI (Playwright)

## Strategi default (semua bisa diubah di "Setelan strategi")
- Universe (rev2): top 30 USDT perp by volume 24j, volume ≥ $50M, spread ≤ 0.05%. Denylist: meme coin + aset non-kripto (XAU, XAG, QQQ, NVDA, MU, SNDK, SKHY, ANT, dll.). Daftar ini best-effort: cek ulang terhadap metadata kontrak Gate.
- Tren 15m: EMA20 vs EMA50
- Trigger 5m: pullback ≤ 0.3% ke EMA20, candle close searah + di atas/bawah EMA20, volume > 1.5× rata² 20 candle
- Filter (rev2): ATR(14) 5m antara 0.25% dan 1% harga
- Posisi (rev2): margin $5 × 5x = notional ≤ $25, SL 2% (≈ -$0.50), TP 4% (≈ +$1), R:R 1:2, time stop 120 menit, maks 1 posisi
- Risk: maks 6 trade/hari UTC, stop jika rugi harian ≤ -$2, jeda 120 menit setelah 3 SL beruntun
- Simulasi: fill di ask/bid + slippage 0.05%, fee taker 0.05%/sisi, funding tiap settlement,
  SL dianggap kena dulu jika SL & TP di candle 1m yang sama, gap melewati SL → fill di open

## Go-live (hanya laporan)
≥ 100 trade, expectancy > 0, profit factor ≥ 1.3, max DD ≤ $5. Selain itu: NOT READY.

## API key (opsional, read-only)
Menu "API Gate (opsional)": isi API Key + Secret → Tes koneksi → tampil saldo futures USDT dan fee akun;
"Pakai fee taker akun di simulasi" menyalin fee asli ke setelan.
- Key hanya untuk membaca `GET /futures/usdt/accounts` dan `GET /wallet/fee`. Proxy menolak path lain (tidak ada endpoint order).
- Tanda tangan HMAC-SHA512 dibuat di browser; secret tidak pernah dikirim ke proxy/Vercel.
- Default disimpan di sessionStorage (hilang saat tab ditutup); centang "Ingat" untuk localStorage.
- Buat key Gate dengan izin read-only, tanpa trade/withdraw, + IP whitelist.
- Butuh proxy (node server.js atau Vercel) dan https/localhost (WebCrypto).

## Backtest
Bagian "Backtest (data historis Gate)": pilih periode (default 90 hari) dan jumlah koin (top volume lolos filter)
atau daftar manual → Jalankan backtest. Butuh proxy (node server.js / Vercel).
- Data 1m diunduh via proxy (2000 bar/request), 5m/15m diagregasi lokal. Jika histori 1m pendek → fallback 5m (per koin, ditampilkan).
- Funding historis dari /futures/usdt/funding_rate.
- Logika = engine live (fungsi yang sama). Entry di open bar setelah sinyal ± setengah spread + slippage.
- Diuji: backtest vs engine live pada data tiruan yang sama → entry & hasil identik (≥97% trade cocok, 0 beda hasil).
- Bias: universe = koin likuid saat ini (survivorship). Hasil masa lalu ≠ hasil ke depan.

## Revisi (rev2) — dari hasil backtest 90 hari v1
- Non-kripto dikeluarkan (denylist). Sebelumnya XAG, QQQ, HYPE menyeret hasil.
- SL 4→2%, TP 8→4%, time stop 240→120 menit. v1: 96% trade keluar lewat time stop, TP/SL hampir tidak tercapai.
- Filter ATR minimum 0.25% baru.
- Setelan lama tidak terbawa (kunci localStorage dinaikkan ke v2). v1 tetap ada sebagai index_v1.html.
- Belum divalidasi. Langkah berikut: grid SL/TP/time stop + walk-forward (pilih di 2 bulan awal, uji di bulan terakhir).
