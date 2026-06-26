# Forge → Oyun Fork İş Akışı

> Tarih: 2026-06-26
> Durum: Planlama / referans doküman. Kod uygulanmadı.
> Amaç: Forge şablonundan bağımsız oyun repoları türetme ve bakım sürecini
> standart hale getirmek.

## Zihinsel Model

```
                 ┌─────────────────────────┐
                 │  Forge (template)        │   origin = github.com/emrtrn/Forge
                 │  engine/ editor/         │   ← genel iyileştirmeler BURADA yaşar
                 │  builder/ tools/ docs/   │
                 └─────────────┬───────────┘
              fork/clone       │  upstream  (oyunlar buradan güncelleme çeker)
        ┌───────────┬──────────┴──────────────┬───────────┐
   ┌────▼────┐ ┌────▼──────┐            ┌─────▼────┐
   │minigolf │ │mini-racer │    …        │ dungeon  │
   │public/  │ │public/    │            │public/   │   her biri = ayrı GitHub repo
   │src/game │ │src/game   │            │src/game  │   ← oyun kodu YALNIZCA burada
   │docs/GDD │ │docs/GDD   │            │docs/GDD  │   ← GDD kendi reposunda
   └─────────┘ └───────────┘            └──────────┘
```

**Altın kural — değişiklik yönü:**
- **Platform kodu** (engine, editor, builder, ortak araçlar) → **Forge'da** yaz,
  oyunlar `upstream`'den çeker.
- **Oyun-özel kod ve data** → yalnızca **`public/` + `src/game`** içinde kalır.
  `engine/`, `editor/`, `builder/`'a oyun-özel kod **girmez**.
  Bu disiplin çakışmayı neredeyse sıfıra indirir.

---

## Klasör Düzeni

```
C:\Users\emret\Desktop\
├── Forge\              ← şablon repo (emrtrn/Forge) — buradan hiç oyun kodu girmez
└── Games\
    ├── minigolf\       ← oyun forkları buraya (emrtrn/minigolf vs.)
    ├── mini-racer\
    └── …
```

---

## Aşama 0 — Forge'u Temiz Template Haline Getir (Fork Açmadan Önce, Bir Kez)

Her fork bu durumu miras alır; ne kadar temizse her oyun o kadar temiz başlar.

1. Demo model temizliği + starter content standardını Forge `main`'de bitir ve commit'le.
2. Kenney araçlarını commit'le (`tools/asset-library-index.mjs`, katalog, TSV, `.gitignore`
   güncellemesi).
3. Forge `main`'i GitHub'a push'la:
   ```bash
   git push origin main
   ```

---

## Aşama 1 — Yeni Oyun Reposu Oluştur

### 1a. GitHub'da boş repo aç
GitHub → New repository → `minigolf` → boş (README olmadan) oluştur.

### 1b. Forge'u klonla, remote'ları ayarla
```bash
git clone https://github.com/emrtrn/Forge.git C:\Users\emret\Desktop\Games\minigolf
cd C:\Users\emret\Desktop\Games\minigolf

# Forge'u upstream yap; yeni origin = oyun reposu
git remote rename origin upstream
git remote add origin https://github.com/emrtrn/minigolf.git
git push -u origin main
```

Sonuç — iki remote:

| Remote     | URL                                    | Amaç                         |
| ---------- | -------------------------------------- | ----------------------------- |
| `origin`   | `github.com/emrtrn/minigolf.git`       | Oyunun kendi GitHub reposu    |
| `upstream` | `github.com/emrtrn/Forge.git`          | Platform güncellemelerini çek |

---

## Aşama 2 — Oyunu Kur

Oyun reposunda yapılacaklar (yalnızca `public/` ve `src/game` içinde):

1. **GDD yaz** → `docs/GDD.md`
   - Çekirdek döngü, asset listesi, gereken sistemler, dikey kesit.
   - Fikir havuzuna (`Forge/docs/planned/KENNEY_GAME_IDEAS.md`) bakarak bağlam kur.

2. **Asset'leri çek** — Kenney arşivinden (`C:/Users/emret/Documents/Kenney`)
   yalnızca ihtiyaç duyulan dosyaları `public/assets/...`'a kopyala.
   - Her asset için kaynak paket + CC0 lisans notunu `docs/ASSET_CREDITS.md`'ye ekle.
   - Arama: `tools/kenney/kenney-assets.tsv` veya `docs/kenney/KENNEY_CATALOG.md`.

3. **Oyun kurallarını yaz** → `src/game/` (GameMode, GameState, kurallar, HUD binding).
   - `engine/`, `editor/`, `builder/`'a oyun-özel kod **ekleme**.

4. **Layout data** → `public/layouts/`, `public/project.3dgame.json`.

---

## Aşama 3 — Forge Güncellemelerini Oyuna Çek

Forge'da genel bir iyileştirme yapıldığında, oyun reposunda:

```bash
git fetch upstream
git merge upstream/main
```

Oyun-özel değişiklikler `public/` + `src/game`'de kaldığı sürece çakışma
neredeyse olmaz. Çakışma olursa yalnızca bu iki klasörde çözülür.

> Alternatif: `git rebase upstream/main` — doğrusal tarih, tek kişilik akışta
> tercih edilebilir. Tercih duruma göre bırakıldı.

---

## Aşama 4 — Platform Eksiğini Forge'a Geri Besle

Oyun yaparken engine/editor'da eksik ya da hata bulunursa:

**Doğru yol — Forge'da düzelt, oyuna çek:**
```bash
# 1. Forge klasörüne geç
cd C:\Users\emret\Desktop\Forge

# 2. Düzeltmeyi yap, commit'le, push'la
git add <dosyalar>
git commit -m "fix: ..."
git push origin main

# 3. Oyuna dön, Forge'dan çek
cd C:\Users\emret\Desktop\Games\minigolf
git fetch upstream
git merge upstream/main
```

**İstisna — yanlışlıkla oyunda kodladıysan:**
```bash
# Oyundaki commit SHA'sını al
git log --oneline -5

# Forge'a geç, cherry-pick ile al
cd C:\Users\emret\Desktop\Forge
git remote add minigolf https://github.com/emrtrn/minigolf.git
git fetch minigolf
git cherry-pick <sha>
git push origin main
```

---

## GDD Politikası

| Doküman | Repo | Açıklama |
| --- | --- | --- |
| `KENNEY_GAME_IDEAS.md` | **Forge** `docs/planned/` | Genel fikir havuzu, tüm oyunlara ortak |
| `GAME_FORK_WORKFLOW.md` | **Forge** `docs/planned/` | Bu doküman — iş akışı referansı |
| `docs/GDD.md` | **Oyun reposu** | O oyuna özel tasarım dokümanı |
| `docs/ASSET_CREDITS.md` | **Oyun reposu** | O oyunda kullanılan Kenney asset'leri + lisans |

---

## Neden Ayrı Repo (Dal Değil)?

| Kriter | Ayrı repo ✅ | Uzun dal ❌ |
| --- | --- | --- |
| Bağımsız yayın (itch.io) | Her repo kendi CI/deploy'u | Dal yayın zorlaşır |
| GDD / issue tracking | Repo başına proje tahtası | Tek repo kalabalıklaşır |
| Çapraz bulaşma riski | Remote sınırı net | Yanlışlıkla merge riski var |
| Oyun sayısı arttıkça | Lineer (1 repo = 1 oyun) | Dal sayısı patlar |

---

## İleride: Scaffold Aracı

İkinci oyun açılmadan önce `tools/create-project.mjs` yazılacak (CLAUDE.md
backlog). Yapacakları:
- Forge'u hedef klasöre kopyala.
- `project.3dgame.json` ve layoutları sıfırla.
- Remote'ları otomatik kur.
- Boş `docs/GDD.md` + `docs/ASSET_CREDITS.md` şablonu oluştur.

İlk oyun için manuel fork yeterli; scaffold'un tam kapsamı ilk oyun sürecinde netleşir.

---

## Özet Kontrol Listesi (Yeni Oyun Açılırken)

- [ ] Forge `main` temiz ve güncel (`git push origin main`)
- [ ] GitHub'da boş oyun reposu oluşturuldu
- [ ] `git clone` + remote'lar ayarlandı (`upstream` = Forge, `origin` = oyun)
- [ ] `docs/GDD.md` yazıldı
- [ ] Asset'ler `public/assets/`'a çekildi + `docs/ASSET_CREDITS.md` dolduruldu
- [ ] Oyun kodu yalnızca `public/` + `src/game`'de
- [ ] İlk commit + push → `origin main`
