# Editor Yapilacaklar Listesi

Kaynak: `C:\Users\emret\Desktop\GPTEditorSohbeti.txt` icindeki web sohbet notlari ve mevcut editor durumu.

## Tamamlananlar

- [x] Scene Outliner temel paneli eklendi.
  - Sahnedeki instance ve character objeleri listeleniyor.
  - Outliner satirina tiklayarak obje secilebiliyor.
- [x] Undo / redo komut yigini eklendi.
  - Place, delete ve transform islemleri temel olarak geri alinabiliyor.
  - Ctrl+Z ve Ctrl+Y / Ctrl+Shift+Z kisayollari var.
- [x] RMB kamera navigasyon modu baslatildi.
  - RMB basiliyken mouse look calisiyor.
  - RMB basiliyken W/A/S/D ve Q/E kamera hareketi calisiyor.
- [x] Content Browser alt panele tasindi.
- [x] Move / rotate / scale snap degerleri toolbar uzerinden secilebiliyor.
- [x] Snap toggle UI eklendi.
  - Grid, rotation ve scale snapping ayri ayri acilip kapatilabiliyor.
- [x] Move snap secenekleri 0.25 / 0.5 / 1 olarak duzenlendi.
- [x] Tool hotkey sistemi eklendi.
  - Q/W/E/R arac secimi, Space transform arac dongusu.
  - RMB kamera navigasyonu aktifken tool hotkey'leri devre disi kalir.
- [x] Delete ve Ctrl+S kisayollari eklendi.
- [x] F ile secili objeye focus eklendi.
- [x] Duplicate eklendi.
  - Ctrl+D secili objeyi cogaltir.
  - Alt + move drag secili objeyi kopyalayip yeni kopyayi surukler.
  - Duplicate islemi undo / redo command stack'e baglidir.

## Kismi Tamamlananlar

- [ ] Scene Outliner guclendirme.
  - [x] Listeleme ve secim var.
  - [x] Arama.
  - [x] Rename.
  - [x] Hide / show.
  - [x] Lock.
  - [ ] Duplicate.
  - [ ] Group.
  - [ ] Parent / child iliskisi.
- [ ] Undo / redo genisletme.
  - [x] Temel command stack var.
  - [x] Duplicate command stack'e baglandi.
  - [x] Rename command stack'e baglandi.
  - [x] Hide ve lock command stack'e baglandi.
  - [ ] Group gibi yeni editor islemleri de command stack'e baglanmali.
- [ ] Snap sistemi.
  - [x] Move / rotate / scale step secimi var.
  - [x] Snap acik / kapali toggle'lari var.
  - [x] Move secenekleri 0.25 / 0.5 / 1 olacak sekilde editor is akisi icin iyilestirildi.
  - [ ] Surface snap, wall snap, floor drop ve bounds snap yok.
- [ ] Kamera input modu.
  - [x] RMB basiliyken kamera kontrolu var.
  - [ ] RMB + mouse wheel ile camera speed ayari yok.
  - [ ] Alt + mouse orbit / pan / zoom yok.

## Oncelikli Siradaki Isler

### P0 - Editor hizini dogrudan artiran isler

- [x] Tool hotkey sistemi ekle.
  - Q: Select.
  - W: Move.
  - E: Rotate.
  - R: Scale.
  - Space: Move -> Rotate -> Scale dongusu.
- [x] F ile secili objeye focus ekle.
  - Kamera secili objeye yaklasip onu merkeze almali.
- [x] Delete kisayolunu bagla.
  - Secili obje Delete tusu ile silinmeli.
- [x] Ctrl+S kisayolunu bagla.
  - Save Layout butonuyla ayni kaydetme akisini calistirmali.
- [x] Ctrl+D duplicate ekle.
  - Secili objeyi ayni transform ile cogaltmali.
- [x] Alt + move drag duplicate ekle.
  - Move gizmo ile Alt basiliyken surukleme kopya olusturmali.

### P1 - Level tasarimini daha guvenli yapan isler

- [x] Snap toggle UI ekle.
  - Grid Snap ON/OFF.
  - Rotation Snap ON/OFF.
  - Scale Snap ON/OFF.
- [x] Move snap seceneklerini ic mekan editore uygun yap.
  - 0.25, 0.5, 1.
- [x] Surface Snap ekle. (Floor Drop buna dahil edildi; ayri tutulmadi.)
  - Secili objenin alt-orta noktasindan asagi isin atip en yakin yuzeye oturtur,
    altinda mesh yoksa zemine (y=0) duser. Kendi geometrisini haric tutar.
  - Details panelinde "Snap to Surface" butonu + End kisayolu (Unreal tarzi),
    undo/redo'ya bagli.
  - Content Browser'dan surukle-birak ve tikla-yerlestir otomatik surface snap:
    imlec altindaki yuzeye (masa/raf ustu) yerlestirir, yoksa zemine.
- [x] Wall Snap ekle.
  - Tablo, raf, pencere gibi placement.surface=="wall" / snapToWall objeleri
    odanin en yakin duvarina (room-shell dunya AABB'sinden turetilen 4 duvar) yapisir
    ve odaya doner.
  - End / "Snap to Wall" butonu duvar asset'lerinde wall snap, digerlerinde surface
    snap yapar (baglamsal). Content Browser'dan birakinca da otomatik wall snap.
  - Varsayim: asset on yuzu +Z'ye bakar; oda yaklasik eksen-hizali kutu. undo/redo'ya bagli.
  - TODO: duvar kalinligi ins'i yok (AABB dis yuzune dayar); serbest oda sekli desteklenmiyor.
- [ ] Bounds Snap ekle.
  - Mobilya kenarlari duvar veya diger mobilya kenarina hizalanabilsin.

### P2 - Profesyonel editor davranislari

- [x] World / Local transform modu ekle.
  - [x] Transform Space: World / Local (toolbar toggle).
  - [x] X kisayolu world/local toggle olarak calisiyor.
  - Not: Objeler sadece Y ekseninde dondugu icin local mod, move arac X/Z oklarini
    objenin yonune cevirir; rotate (Y) ve uniform scale her iki modda ayni calisir.
- [ ] Pivot duzenleme icin ilk altyapiyi planla.
  - Ozellikle kapi, pencere, dolap kapagi ve kose objelerinde gerekli olacak.
- [ ] Viewport orbit / pan / zoom ekle.
  - Alt + LMB: orbit.
  - Alt + MMB: pan.
  - Alt + RMB: zoom / dolly.
- [ ] Camera Speed ayari ekle.
  - RMB + mouse wheel ile hiz artip azalabilmeli.
- [ ] Top / Front / Side View ekle.
  - Hizalama isleri icin teknik gorunumler.

### P3 - Selection ve organizasyon

- [ ] Coklu secim ekle.
  - Ctrl + LMB veya Shift + LMB ile secime ekleme.
- [ ] Drag selection box ekle.
- [ ] Esc ile secimi temizle.
- [ ] Ctrl+A ile tum objeleri sec.
- [ ] H ile secili objeyi gizle.
- [ ] Shift+H ile gizlenenleri goster.
- [ ] Lock Movement ekle.
  - Kilitli obje yanlislikla tasinmamali.
- [ ] Ctrl+G ile group ekle.
  - Ornek: yatak + komodin + lamba seti tek parca gibi tasinabilmeli.

### P4 - Details panelini oyun datasi uretir hale getirme

- [ ] Name alani ekle.
- [ ] Category alani goster.
- [ ] Transform bolumunu genislet.
  - [x] Location X/Y/Z. (Detaylar panelinde yan yana, X/Y/Z renk etiketli.)
  - [x] Rotation X/Y/Z. (Tam Euler; gizmo'da X/Y/Z donme halkalari.)
  - [x] Scale X/Y/Z. (Eksen bazli; gizmo'da eksen bazli scale tutamaklari.)
  - [x] Scale kilidi. (Acikken eksenler oranli olcekler; details + gizmo.)
  - [ ] Reset.
  - [ ] Copy.
  - [ ] Paste.
- [ ] Placement bolumu ekle.
  - Snap to Floor.
  - Snap to Wall.
  - Lock Movement.
  - Cast Shadow.
  - Collision Enabled.
- [ ] Metadata bolumu ekle.
  - Price.
  - Comfort.
  - Style.
  - Room Tags.
  - comfortScore.
  - roomType.
  - interactable.
  - placementRules.

### P5 - Preview ve test akisi

- [ ] G ile Preview Mode ekle.
  - Gizmo, grid ve editor helper cizgileri gizlenmeli.
- [ ] P ile Play/Test Mode ekle.
  - Oyuncunun gorecegi runtime davranisini editor icinden test etmeli.
- [ ] F11 fullscreen viewport ekle.
- [ ] Ctrl+R realtime render toggle ekle.

## Onerilen Uygulama Sirasi

1. [x] Tool hotkeys: Q/W/E/R, Space, Delete, Ctrl+S.
2. [x] F focus selected.
3. [x] Duplicate: Ctrl+D ve Alt+drag.
4. [x] Snap toggle'lari ve move snap degerlerinin 0.25 / 0.5 / 1 olarak duzenlenmesi.
5. [x] Outliner arama, rename, hide/show, lock.
   - [x] Arama.
   - [x] Rename.
   - [x] Hide/show.
   - [x] Lock.
6. [x] World / Local transform toggle.
7. [x] Floor drop, surface snap, wall snap.
   - [x] Surface snap (floor drop dahil; placement'ta otomatik snap).
   - [x] Wall snap (en yakin duvara baglamsal snap + placement'ta otomatik).
8. Multi-select, box select ve grouping.
9. Details panel gameplay metadata alanlari.
10. Preview/Game View.
