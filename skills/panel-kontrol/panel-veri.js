// Digico Panel salt okunur veri yardımcısı.
// digicopanel.com sekmesinde, yöneticinin kendi açık oturumuyla çalışır.
// Sadece GET isteği atar; oturum anahtarını hiçbir yere döndürmez veya yazdırmaz.
(() => {
  if (window.__digico && window.__digico.surum === 6) return 'hazir';

  // Ajanın okumaması kararlaştırılan dosyalar ve gereksiz kişisel iletişim bilgileri.
  const GIZLI = new Set([
    'tax_certificate', 'contract_document', 'receipt', 'trello_raw_data', 'phone', 'firm_phone',
    'email', 'instagram_email', 'address', 'adres', 'birth_date', 'profile_photo', 'user', 'phone_number', 'clean_phone',
  ]);
  const TARIH_ALANLARI = [
    'created_at', 'updated_at', 'completed_at', 'due_date', 'meeting_date', 'observation_date',
    'contact_date', 'date', 'task_date', 'report_date', 'uploaded_at', 'tarih', 'scheduled_date',
    'answered_at', 'payment_date', 'arrival_date', 'week_start',
  ];
  const PARCA = 15000;
  const MAKS_REKLAM_GUNU = 31;

  const HARF = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i' };
  const norm = (s) => String(s ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/[çğıöşüâî]/g, (c) => HARF[c]);

  const tarih = (v) => {
    if (typeof v !== 'string') return null;
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  // Kaydın tarih alanlarından biri aralıktaysa (ya da hiç tarih alanı yoksa) true.
  const aralikta = (k, bas, bit) => {
    if (!k || typeof k !== 'object') return true;
    const t = TARIH_ALANLARI.map((a) => tarih(k[a])).filter(Boolean);
    return !t.length || t.some((x) => x >= bas && x <= bit);
  };

  const gunEkle = (s, n) => {
    const d = new Date(`${s}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const bugun = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const pazartesi = (s) => gunEkle(s, -((new Date(`${s}T12:00:00Z`).getUTCDay() + 6) % 7));
  const gunler = (bas, bit) => {
    const g = [];
    for (let d = bas; d <= bit; d = gunEkle(d, 1)) g.push(d);
    return g;
  };
  const aylar = (bas, bit) => {
    const a = [];
    let [y, m] = bas.split('-').map(Number);
    const [by, bm] = bit.split('-').map(Number);
    while (y < by || (y === by && m <= bm)) {
      a.push([y, m]);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return a;
  };
  const haftaOfsetleri = (bas, bit) => {
    const buHafta = pazartesi(bugun());
    const o = [];
    for (let p = pazartesi(bas); p <= bit; p = gunEkle(p, 7)) {
      o.push(Math.round((new Date(p) - new Date(buHafta)) / 604800000));
    }
    return o;
  };

  const token = () => {
    const c = document.cookie.split('; ').find((x) => x.startsWith('accessToken='));
    return c ? decodeURIComponent(c.slice('accessToken='.length)) : null;
  };

  async function get(yol, params) {
    if (!yol.startsWith('/api/')) throw new Error('Sadece /api/ yolları okunabilir');
    if (params) yol += (yol.includes('?') ? '&' : '?') + new URLSearchParams(params);
    const t = token();
    if (!t) throw new Error('OTURUM_YOK');
    const r = await fetch(yol, { method: 'GET', headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });
    if (r.status === 401) throw new Error('OTURUM_YOK');
    if (!r.ok) throw new Error(`HTTP ${r.status} ${yol.split('?')[0]}`);
    return r.json();
  }

  const liste = (c) => (Array.isArray(c) ? c : (c && (c.results || c.data || c.items)) || []);

  // Boş alanları ve gizli alanları atar, JSON metin olarak saklanmış notları açar.
  const temizle = (v) => {
    if (Array.isArray(v)) return v.map(temizle);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        if (GIZLI.has(k) || x === null || x === '') continue;
        if (Array.isArray(x) && !x.length) continue;
        if (x && typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length) continue;
        o[k] = temizle(x);
      }
      return o;
    }
    if (typeof v === 'string' && /^[[{]/.test(v.trim())) {
      try { return temizle(JSON.parse(v)); } catch (e) { /* düz metin */ }
    }
    return v;
  };

  async function sinirli(isler, n = 6) {
    const sonuc = new Array(isler.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, isler.length) }, async () => {
      while (i < isler.length) {
        const j = i++;
        sonuc[j] = await isler[j]();
      }
    }));
    return sonuc;
  }

  // Aylık şablonun "01.09.2026 — …" / "07.09 : Pazartesi …" biçimli birikmiş metinlerinden
  // sadece tarih aralığındaki girdileri bırakır. Tarihli girdi yoksa metni olduğu gibi döndürür.
  // Birikmiş metni satır başındaki tarihlere göre girdilere böler: [{ tarih, metin }].
  function girdilereBol(metin, bas) {
    const girdiler = [];
    for (const satir of metin.split('\n')) {
      const m = satir.match(/^\s*(\d{2})\.(\d{2})(?:\.(\d{4}))?/);
      if (m) girdiler.push({ tarih: `${m[3] || bas.slice(0, 4)}-${m[2]}-${m[1]}`, satirlar: [satir] });
      else if (girdiler.length) girdiler[girdiler.length - 1].satirlar.push(satir);
      else girdiler.push({ tarih: null, satirlar: [satir] });
    }
    return girdiler.map((g) => ({ tarih: g.tarih, metin: g.satirlar.join('\n') }));
  }

  function metniAraligaKirp(metin, bas, bit) {
    if (typeof metin !== 'string') return metin;
    const girdiler = girdilereBol(metin, bas);
    if (!girdiler.some((g) => g.tarih)) return metin;
    return girdiler.filter((g) => !g.tarih || (g.tarih >= bas && g.tarih <= bit))
      .map((g) => g.metin).join('\n').trim();
  }

  // Aylık şablonda her gün değişmeyen firma profil alanları (personel dosyasında tekrar etmesin).
  const SABLON_PROFIL = /^(display_order|bulundugu_sehir|sattigi_markalar.*|.*_var_mi|baslangic_takipci_sayisi|firma_baslangic_tarihi|reklam_butcesi|firma_sorumlusu|yedek_sorumlu)$|_(parts|entries|part_counts|missing_reason)$/;

  // Aylık şablon günlük satırları: metin alanları gün gün birikerek tekrarlanır.
  // Her alan için yalnızca farklı (ve birbirini kapsamayan) metinleri, sayılar için değişen seriyi tutar.
  function sablonOzet(satirlar, bas, bit) {
    const secili = satirlar.filter((s) => { const t = tarih(s.date); return !t || (t >= bas && t <= bit); });
    const ozet = { gun_sayisi: secili.length };
    const seri = {};
    // Her metnin şablonda ilk göründüğü gün: tarih yazılmamış notların ne zaman girildiği kaybolmasın.
    const ilkGun = {};
    for (const s of secili) {
      for (const [k, v] of Object.entries(s)) {
        if (k === 'date' || GIZLI.has(k) || v === null || v === '') continue;
        if (typeof v === 'number') { (seri[k] ||= []).push([s.date, v]); continue; }
        const metin = typeof v === 'string' ? metniAraligaKirp(v, bas, bit) : JSON.stringify(temizle(v));
        if (!metin || metin === '[]' || metin === '{}') continue;
        const mevcut = (ozet[k] ||= []);
        if (mevcut.some((m) => m.includes(metin))) continue;
        const gunler = (ilkGun[k] ||= new Map());
        const kapsanan = mevcut.filter((m) => metin.includes(m));
        gunler.set(metin, [tarih(s.date), ...kapsanan.map((m) => gunler.get(m))].filter(Boolean).sort()[0]);
        ozet[k] = mevcut.filter((m) => !metin.includes(m)).concat(metin);
      }
    }
    for (const [k, gunler] of Object.entries(ilkGun)) {
      ozet[k] = ozet[k].map((m) => (gunler.get(m) ? `[şablona ilk girildiği gün: ${gunler.get(m)}] ${m}` : m));
    }
    for (const k of Object.keys(ozet)) if (Array.isArray(ozet[k]) && ozet[k].length === 1) [ozet[k]] = ozet[k];
    for (const [k, v] of Object.entries(seri)) {
      if (new Set(v.map((x) => x[1])).size > 1) ozet[`${k}_gunluk`] = v;
      else [[, ozet[k]]] = v;
    }
    return ozet;
  }

  function yeniDosya(tur, id, bas, bit) {
    bas = tarih(bas); bit = tarih(bit);
    if (!bas || !bit || bas > bit) throw new Error('Tarihleri YYYY-AA-GG biçiminde verin; başlangıç bitişten önce olmalı');
    return { tur, id: String(id), baslangic: bas, bitis: bit, olusturma: new Date().toISOString(), bolumler: {}, okunamayanlar: {} };
  }

  async function bolum(d, ad, f) {
    try {
      d.bolumler[ad] = temizle(await f());
    } catch (e) {
      if (e.message === 'OTURUM_YOK') throw e;
      d.okunamayanlar[ad] = String(e.message || e);
    }
  }

  function ozet(d) {
    const bolumler = {};
    for (const [ad, v] of Object.entries(d.bolumler)) {
      const boyut = JSON.stringify(v ?? null).length;
      bolumler[ad] = {
        kayit: Array.isArray(v) ? v.length : (v && typeof v === 'object' ? 'nesne' : v),
        parca: Math.max(1, Math.ceil(boyut / PARCA)),
      };
    }
    return { tur: d.tur, id: d.id, baslangic: d.baslangic, bitis: d.bitis, bolumler, okunamayanlar: d.okunamayanlar };
  }

  let yoneticiMi = null;
  async function yoneticiKontrol() {
    if (yoneticiMi === null) {
      const me = await get('/api/auth/me/');
      yoneticiMi = /yonetici|admin/.test(norm(`${me.role} ${me.department}`));
    }
    if (!yoneticiMi) throw new Error('Bu ajan sadece yönetici hesaplarıyla kullanılabilir');
  }

  let firmaOnbellek = null;
  const tumFirmalar = async () => (firmaOnbellek ||= liste(await get('/api/firms/', { all: 'true', lite: 'true' })));

  const api = {
    surum: 6,
    son: null,

    async durum() {
      try {
        const me = await get('/api/auth/me/');
        yoneticiMi = /yonetici|admin/.test(norm(`${me.role} ${me.department}`));
        return { girisli: true, ad: me.name, rol: me.role, yonetici: yoneticiMi, bugun: bugun() };
      } catch (e) {
        if (e.message === 'OTURUM_YOK') return { girisli: false, bugun: bugun() };
        throw e;
      }
    },

    async firmaAra(metin) {
      await yoneticiKontrol();
      const a = norm(metin);
      const bulunan = (await tumFirmalar()).filter((f) => norm(f.name).includes(a) || norm(f.instagram_username).includes(a));
      return {
        toplam: bulunan.length,
        firmalar: bulunan.slice(0, 30).map((f) => ({
          firm_id: f.firm_id, ad: f.name, durum: f.status, sektor: f.sector,
          sorumlu: f.primary_staff_name, yedek: f.backup_staff_name, calismama: f.calismama_durumu,
        })),
      };
    },

    async personelAra(metin) {
      await yoneticiKontrol();
      const a = norm(metin);
      return liste(await get('/api/staff/')).filter((s) => norm(s.name).includes(a))
        .map((s) => ({ staff_id: s.staff_id, ad: s.name, rol: s.role, birim: s.department, aktif: s.is_active }));
    },

    async firmaDosyasi(fid, bas, bit) {
      await yoneticiKontrol();
      const d = yeniDosya('firma', fid, bas, bit);
      fid = d.id; bas = d.baslangic; bit = d.bitis;
      const B = d.bolumler;

      await bolum(d, 'firma', () => get(`/api/firms/${fid}/`));
      const firmaAdi = (B.firma && B.firma.name) || '';
      const ad = norm(firmaAdi);
      const instagram = (B.firma && B.firma.instagram_username) || '';
      await bolum(d, 'sorumlular', async () => liste(await get('/api/firm-responsibilities/', { firm: fid })));
      const sorumluIdleri = [...new Set((B.sorumlular || []).map((r) => r.staff).filter(Boolean).map(String))];

      await Promise.all([
        // Görev listesinde firma filtresi yok: sorumluların görevlerinden firmaya bağlı
        // olanlar ya da metninde firma adı geçenler seçilir.
        bolum(d, 'yonetici_gorevleri', async () => {
          const gorulen = new Set();
          const secilen = [];
          for (const sid of sorumluIdleri) {
            for (const g of liste(await get('/api/admin-task-assignments/', { assigned_to: sid }))) {
              if (gorulen.has(g.task_assignment_id)) continue;
              const metin = norm([g.title, g.description, g.staff_notes, g.admin_notes].join(' '));
              const firmayaAit = String(g.firm) === fid || (ad.length >= 4 && metin.includes(ad));
              if (firmayaAit && aralikta(g, bas, bit)) {
                gorulen.add(g.task_assignment_id);
                secilen.push(g);
              }
            }
          }
          return secilen;
        }),
        bolum(d, 'aylik_sablon', async () => {
          const aySonuclari = await Promise.all(aylar(bas, bit).map(([y, m]) => get('/api/monthly-template/firm-history/', { firm_id: fid, month: m, year: y })));
          return sablonOzet(aySonuclari.flatMap((r) => liste(r.history)), bas, bit);
        }),
        bolum(d, 'toplantilar', async () => liste(await get('/api/meeting-logs/', { firm: fid, meeting_date__gte: bas, meeting_date__lte: bit }))),
        bolum(d, 'sosyal_medya', async () => {
          const sm = await get(`/api/social-media/firms/${fid}/detail/`);
          return {
            kayitlar: liste(sm.history).filter((x) => aralikta(x, bas, bit)),
            gorusme_ve_gorevler: liste(sm.meetings).filter((x) => aralikta(x, bas, bit)),
          };
        }),
        bolum(d, 'tutan_kreatif', async () => {
          const haftalar = await Promise.all(haftaOfsetleri(bas, bit).map((o) => get('/api/tutan-kreatif/week/', { week_offset: o })));
          return haftalar.flatMap((h) => liste(h.firms).filter((f) => String(f.firm_id) === fid));
        }),
        bolum(d, 'reklam_durumu', async () => {
          const gunListesi = gunler(bas, bit).slice(-MAKS_REKLAM_GUNU);
          const satirlar = await sinirli(gunListesi.map((g) => async () => {
            const r = await get('/api/reklam-guncelleme/status/', { firm_id: fid, date: g });
            return {
              tarih: g, durum: r.durum_otomatik, dun_harcama: r.dun_harcama, dun_roas: r.dun_roas,
              hedef_roas: r.hedef_roas, ust_uste_kotu_gun: r.ust_uste_kotu_gun_sayisi, kritik: r.is_kritik,
              kritik_sebep: r.kritik_sebep, degerlendirme: r.degerlendirme, acik_dongu: r.open_dongu,
              butce_kayitlari: r.son_kayit && r.son_kayit.butce_list,
              teshis_kayitlari: r.son_kayit && r.son_kayit.teshis_list,
              _teshis_gecmisi: r.teshis_gecmisi,
            };
          }));
          const sonGecmis = satirlar.length ? satirlar[satirlar.length - 1]._teshis_gecmisi : null;
          satirlar.forEach((s) => delete s._teshis_gecmisi);
          return { gunluk: satirlar, teshis_gecmisi: sonGecmis };
        }),
        bolum(d, 'meta_ve_ciro', async () => liste(await get('/api/financial-logs/', { firm_id: fid, date__gte: bas, date__lte: bit, include_meta: 'true' }))),
        bolum(d, 'gozlemler', async () => liste(await get('/api/observations/', { firm: fid })).filter((x) => aralikta(x, bas, bit))),
        bolum(d, 'musteri_iletisim', async () => liste(await get('/api/customer-contact-logs/', { firm: fid, contact_date__gte: bas })).filter((x) => aralikta(x, bas, bit))),
        bolum(d, 'aylik_raporlar_tum_zamanlar', async () => liste(await get('/api/monthly-reports/', { firm_id: fid }))),
        bolum(d, 'memnuniyet', async () => ({
          kampanya_yorumlari: liste((await get(`/api/firms/${fid}/satisfaction-kampanya-yorum/`)).entries),
          aramalar: instagram ? liste(await get('/api/accounting/satisfaction-calls/', { instagram })) : [],
        })),
        bolum(d, 'odeme_gecmisi', () => get(`/api/accounting/payments/${fid}/payment-history/`)),
        // Pazarlama tarafı: beklenti, pazarlama özel notları, Pazarlama→Muhasebe notları ve firmanın
        // telefonuyla eşleşen arama kayıtları. Telefon numaraları çıktıdan atılır.
        bolum(d, 'pazarlama', async () => {
          const mf = await get(`/api/marketing/firms/${fid}/`);
          let aramalar = null;
          if (mf.phone) {
            try {
              aramalar = await get('/api/phone-call-logs/search_by_phone/', { phone: mf.phone });
            } catch (e) {
              if (e.message === 'OTURUM_YOK') throw e;
              aramalar = { okunamadi: e.message };
            }
          }
          return {
            beklenti: mf.beklenti, pazarlama_ozel_notlari: mf.marketing_private_notes,
            pazarlamadan_muhasebeye_notlar: mf.accounting_notes, telefonla_eslesen_arama_kayitlari: aramalar,
          };
        }),
        bolum(d, 'marka_kurulum_olaylari', async () => liste((await get('/api/marka-kurulum/olay-kaydi/', { firma_id: fid, limit: 200 })).olaylar)),
        bolum(d, 'web_yazilim_isleri', async () => {
          if (!firmaAdi) return [];
          return liste(await get('/api/software/web-firms/', { search: firmaAdi }))
            .filter((w) => norm(w.firm_name).includes(ad) || ad.includes(norm(w.firm_name)));
        }),
        bolum(d, 'giden_arama_kuyrugu', async () => {
          const aySonuclari = await Promise.all(aylar(bas, bit).map(([y, m]) => get('/api/churn-callback-queue/', { period: `${y}-${String(m).padStart(2, '0')}` })));
          return aySonuclari.flatMap((r) => liste(r)).filter((x) => String(x.firm) === fid || (ad && norm(x.firm_name) === ad));
        }),
      ]);

      api.son = d;
      return ozet(d);
    },

    async personelDosyasi(sid, bas, bit) {
      await yoneticiKontrol();
      const d = yeniDosya('personel', sid, bas, bit);
      sid = d.id; bas = d.baslangic; bit = d.bitis;
      let personelKaydi = null;
      try {
        personelKaydi = await get(`/api/staff/${sid}/`);
      } catch (e) {
        if (e.message === 'OTURUM_YOK') throw e;
      }
      const pazarlamaMi = Boolean(personelKaydi) && /pazarlama/.test(norm(`${personelKaydi.role} ${personelKaydi.department}`));
      const donemler = aylar(bas, bit).map(([y, m]) => [y, m, `${y}-${String(m).padStart(2, '0')}`]);

      // Pazarlama personelinin arama, durum, satış ve prim kayıtları. Arama listesinin tamamı çok büyük
      // (binlerce kayıt) olduğu için gün gün, tamamlanma tarihine göre çekilir.
      const pazarlamaBolumleri = pazarlamaMi ? [
        bolum(d, 'arama_kayitlari', async () => {
          const gunluk = await sinirli(gunler(bas, bit).slice(-62).map((gun) => async () => liste(await get('/api/phone-call-logs/', { date: gun, use_completed_date: 'true' }))));
          return gunluk.flat().filter((a) => String(a.called_by) === sid);
        }),
        bolum(d, 'arama_durum_ozeti', async () => Promise.all(donemler.map(async ([y, m, donem]) => {
          const r = await get('/api/phone-call-logs/monthly-status-summary/', { year: y, month: m, staff_id: sid });
          return { ay: donem, toplam_kayit: r.total_records, durumlar: liste(r.status_counts).map((x) => ({ durum: x.label, kayit: x.count, firma: x.firm_count })) };
        }))),
        bolum(d, 'satislar', async () => liste(await get('/api/marketing/sales/', { staff_id: sid }))
          .filter((s) => { const t = tarih(s.sale_date); return !t || (t >= bas && t <= bit); })),
        bolum(d, 'satis_prim_ozeti', async () => Promise.all(donemler.map(async ([y, m, donem]) => {
          const r = await get('/api/marketing/sales/summary/', { staff_id: sid, month: m, year: y });
          return { ay: donem, toplam_satis: r.total_sales, sonraki_prime_kalan: r.remaining_amount, ilerleme_yuzde: r.progress_percentage, mevcut_prim: r.current_bonus, sonraki_prim: r.next_bonus };
        }))),
      ] : [];

      await Promise.all([
        ...pazarlamaBolumleri,
        bolum(d, 'giden_arama_kuyrugu', async () => {
          const kayitlar = [];
          for (const [, , donem] of donemler) kayitlar.push(...liste(await get('/api/churn-callback-queue/', { period: donem, staff_id: sid })));
          return kayitlar.filter((k) => aralikta({ tarih: k.called_at || k.created_at }, bas, bit));
        }),
        bolum(d, 'personel', async () => personelKaydi || get(`/api/staff/${sid}/`)),
        bolum(d, 'sorumlu_oldugu_firmalar', async () => liste(await get('/api/firm-responsibilities/', { staff: sid }))),
        bolum(d, 'yonetici_gorevleri', async () => liste(await get('/api/admin-task-assignments/', { assigned_to: sid })).filter((g) => aralikta(g, bas, bit))),
        bolum(d, 'aylik_sablon_firmalari', async () => {
          const aySonuclari = await Promise.all(aylar(bas, bit).map(([y, m]) => get('/api/monthly-template/data/', { staff_id: sid, month: m, year: y })));
          const kirp = (f) => Object.fromEntries(Object.entries(f)
            .filter(([k]) => !SABLON_PROFIL.test(k))
            .map(([k, v]) => [k, metniAraligaKirp(v, bas, bit)]));
          return aySonuclari.map((r, i) => ({ ay: aylar(bas, bit)[i].join('-'), firmalar: liste(r.firms).map(kirp) }));
        }),
        bolum(d, 'ekip_takibi', async () => {
          const r = await get('/api/dashboard/team-tracking/daily/', { date_from: bas, date_to: bit });
          return {
            gorevler: liste(r.staff).filter((s) => String(s.staff_id) === sid),
            bu_ay_uyari_sayisi: r.warnings ? (r.warnings[sid] || 0) : null,
          };
        }),
        bolum(d, 'yonetici_notlari', async () => liste(await get('/api/staff-notes/', { staff: sid }))),
        // Uyarı metinleri yöneticiye özel uçtan gelir; panelde henüz yayında değilse HTTP 404 döner.
        bolum(d, 'uyarilar', async () => liste((await get('/api/dashboard/team-tracking/warnings/', { staff_id: sid, date_from: bas, date_to: bit })).warnings)),
        bolum(d, 'soru_cevap_ona_sorulan', async () => liste(await get('/api/colleague-qa/', { asked_to_id: sid })).filter((x) => aralikta(x, bas, bit))),
        bolum(d, 'soru_cevap_onun_sordugu', async () => liste(await get('/api/colleague-qa/', { staff_id: sid })).filter((x) => aralikta(x, bas, bit))),
      ]);

      api.son = d;
      return ozet(d);
    },

    // Yönetici görevleri denetimi: aralıkta son tarihi (yoksa oluşturulma tarihi) düşen görevlerde
    // kim zamanında yaptı, kim geç yaptı, kim yapmadı, kim okumadı, kim notsuz tamamladı.
    // Devamlı şablon kayıtları (duration_type='ongoing') tek başına görev değildir, sayılmaz;
    // şablonların her gün ürettiği "Günün görevi" kayıtları sayılır.
    // Yöneticiler güncel durumu soruyor: tarih verilmezse son 30 günde VERİLEN görevler denetlenir,
    // daha uzun aralıkta yalnızca son 31 gün alınır; görevler en son verilenden eskiye sıralanır.
    async gorevDenetimi(bas, bit, { personelId } = {}) {
      await yoneticiKontrol();
      const bugunTarih = bugun();
      bit = tarih(bit) || bugunTarih;
      if (bit > bugunTarih) bit = bugunTarih;
      bas = tarih(bas) || gunEkle(bit, -30);
      const kirpildi = bas < gunEkle(bit, -31);
      if (kirpildi) bas = gunEkle(bit, -30);
      const d = yeniDosya('gorev', personelId || 'tum', bas, bit);
      bas = d.baslangic; bit = d.bitis;
      if (kirpildi) d.kapsam_notu = `İstenen aralık 31 günden uzundu; yalnızca son 31 günde verilen görevler (${bas} – ${bit}) denetlendi.`;
      const simdi = new Date();
      const tumGorevler = liste(await get('/api/admin-task-assignments/'));
      const icerikBos = (s) => {
        const n = norm(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        return !n || n.length < 12 || /^(yapildi|tamam(landi|dir)?|ok|sesli soylendi|iletildi|bitti|evet|hallettim|halledildi)( |$)/.test(n);
      };
      const siniflandir = (g) => {
        const son = g.due_date ? new Date(g.due_date) : null;
        if (g.status === 'completed') {
          const bitti = g.completed_at ? new Date(g.completed_at) : null;
          return son && bitti && bitti > son ? 'gec_tamamlandi' : 'zamaninda_tamamlandi';
        }
        if (g.status === 'cancelled') return 'iptal';
        return son && son < simdi ? 'yapilmadi_suresi_gecti' : 'bekliyor';
      };

      const secilen = tumGorevler
        .filter((g) => g.duration_type !== 'ongoing' && (!personelId || String(g.assigned_to) === String(personelId)))
        .filter((g) => { const t = tarih(g.created_at) || tarih(g.due_date); return t && t >= bas && t <= bit; })
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

      // Devamlı şablonların her gün ürettiği görevler tek seferlik görevlerden ayrı değerlendirilir:
      // - "Giden marka araması": personel çoğu zaman görevi "Bitir"lemeden giden arama kuyruğundan arar.
      //   O gün arama kaydı varsa, kişiye o gün için liste henüz atanmamışsa ya da listesi son 7 günde
      //   verildiyse "yapılmadı" sayılmaz.
      // - Hatırlatma görevleri ("her gün gelir, sadece kontrol gününüzse doldurun") her gün yapılmaz;
      //   o gün aylık şablona görüşme kaydı girilip girilmediğine bakılır.
      // - Görevi ya da şablonu 7 günden yeni olup henüz yapılmamış görevler "yeni verildi" diye ayrılır.
      const YENI_GUN = 7;
      const gunFarki = (a, b) => Math.round((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400000);
      const gidenAramaMi = (baslik) => /giden (marka|firma) aramas/.test(norm(baslik));
      const hatirlatmaMi = (g) => /hatirlatma her gun gelir|gununuzse doldurun/.test(norm(g.description));
      const donemler = aylar(bas, bit).map(([y, m]) => `${y}-${String(m).padStart(2, '0')}`);

      const sablonOlusma = new Map(); // schedule_id -> şablonun oluşturulduğu gün
      await bolum(d, 'aktif_devamli_sablonlar', async () => {
        const sablonlar = liste(await get('/api/admin-task-recurring-schedules/'));
        for (const s of sablonlar) sablonOlusma.set(String(s.schedule_id), tarih(s.created_at));
        return sablonlar.filter((s) => s.is_active && (!personelId || String(s.assigned_to) === String(personelId)))
          .map((s) => ({ baslik: s.title, personel: s.assigned_to_name, atayan: s.assigned_by_name, olusturma: tarih(s.created_at), saat: s.dispatch_time, bitis: s.end_date, son_gonderim: s.last_dispatched_date }));
      });

      const aramaSayisi = new Map(); // "staff|gün" -> o gün yapılan arama
      const listeIlkGun = new Map(); // "staff|YYYY-AA" -> o ayki arama listesinin ilk atandığı gün
      const kuyrukKayitlari = new Map(); // "staff|YYYY-AA" -> [{ eklenme, arandi }]
      await bolum(d, 'giden_arama_kuyrugu', async () => {
        let aranan = 0;
        for (const donem of donemler) {
          for (const k of liste(await get('/api/churn-callback-queue/', { period: donem }))) {
            const ilkAnahtar = `${k.staff}|${donem}`;
            const eklenme = tarih(k.created_at);
            if (eklenme && (!listeIlkGun.has(ilkAnahtar) || eklenme < listeIlkGun.get(ilkAnahtar))) listeIlkGun.set(ilkAnahtar, eklenme);
            if (eklenme) {
              if (!kuyrukKayitlari.has(ilkAnahtar)) kuyrukKayitlari.set(ilkAnahtar, []);
              kuyrukKayitlari.get(ilkAnahtar).push({ eklenme, arandi: k.is_called ? tarih(k.called_at) : null });
            }
            if (!k.is_called || !k.called_at) continue;
            const gunAnahtar = `${k.staff}|${tarih(k.called_at)}`;
            aramaSayisi.set(gunAnahtar, (aramaSayisi.get(gunAnahtar) || 0) + 1);
            aranan += 1;
          }
        }
        return { aranan_kayit: aranan, liste_atanmis_personel_ay: listeIlkGun.size };
      });

      // Hatırlatma görevi olan personelin aylık şablonundaki görüşme kayıtları: "staff|gün" -> kayıt girilen firma.
      // Şablonu okunamayan personel (panel bazı hesaplar için aylık şablon tutmuyor, 403 döner) ayrı işaretlenir;
      // bir kişinin hatası diğerlerinin kayıtlarını düşürmez.
      const sablonKaydi = new Map();
      const sablonOkunamayan = new Set();
      const hatirlatmaPersoneli = [...new Set(secilen.filter((g) => g.recurring_schedule && hatirlatmaMi(g)).map((g) => String(g.assigned_to)))];
      await bolum(d, 'hatirlatma_sablon_kayitlari', async () => {
        const hatalar = [];
        for (const sid of hatirlatmaPersoneli) {
          try {
            for (const [y, m] of aylar(bas, bit)) {
              const veri = await get('/api/monthly-template/data/', { staff_id: sid, month: m, year: y });
              for (const f of liste(veri.firms)) {
                const kayitGunleri = new Set();
                for (const [alan, deger] of Object.entries(f)) {
                  if (typeof deger !== 'string' || !/musteriyle_gorusuldu_mu|gune_bir|gunde_bir/.test(alan)) continue;
                  for (const girdi of girdilereBol(deger, `${y}-01-01`)) {
                    if (girdi.tarih && !/iletisime gecilmedi/.test(norm(girdi.metin))) kayitGunleri.add(girdi.tarih);
                  }
                }
                for (const gun of kayitGunleri) sablonKaydi.set(`${sid}|${gun}`, (sablonKaydi.get(`${sid}|${gun}`) || 0) + 1);
              }
            }
          } catch (e) {
            if (e.message === 'OTURUM_YOK') throw e;
            sablonOkunamayan.add(sid);
            hatalar.push(`${(secilen.find((g) => String(g.assigned_to) === sid) || {}).assigned_to_name || sid}: ${e.message}`);
          }
        }
        return { personel: hatirlatmaPersoneli.length, sablonu_okunamayan: hatalar };
      });

      const degerlendir = (g, durum) => {
        const gun = tarih(g.due_date) || tarih(g.created_at);
        const verilme = tarih(g.created_at) || gun;
        if (g.recurring_schedule && hatirlatmaMi(g) && durum === 'yapilmadi_suresi_gecti') {
          if (sablonOkunamayan.has(String(g.assigned_to))) return 'hatirlatma_sablon_okunamadi';
          return sablonKaydi.get(`${g.assigned_to}|${gun}`) ? 'hatirlatma_sablona_islenmis' : 'hatirlatma_o_gun_kayit_yok';
        }
        if (durum !== 'yapilmadi_suresi_gecti') return durum;
        if (gidenAramaMi(g.title)) {
          if (aramaSayisi.get(`${g.assigned_to}|${gun}`)) return 'isaretsiz_ama_arama_var';
          const ayAnahtar = `${g.assigned_to}|${gun.slice(0, 7)}`;
          const ilk = listeIlkGun.get(ayAnahtar);
          if (!ilk || ilk > gun) return 'kuyruk_atanmamis';
          if (gunFarki(gun, ilk) < YENI_GUN) return 'liste_yeni_verildi';
          // O gün listede aranmayı bekleyen firma kalmamışsa arama yapılamazdı.
          const bekleyen = kuyrukKayitlari.get(ayAnahtar).filter((k) => k.eklenme <= gun && (!k.arandi || k.arandi > gun)).length;
          if (!bekleyen) return 'aranacak_kalmamis';
        }
        if (!g.recurring_schedule) return gunFarki(bugunTarih, verilme) < YENI_GUN ? 'yeni_verildi_henuz_yapilmadi' : durum;
        const sablonGunu = sablonOlusma.get(String(g.recurring_schedule));
        if (sablonGunu && gunFarki(gun, sablonGunu) < YENI_GUN) return 'yeni_verildi_henuz_yapilmadi';
        return durum;
      };

      const gorevler = secilen.map((g) => {
        const durum = siniflandir(g);
        const gun = tarih(g.due_date) || tarih(g.created_at);
        return {
          id: g.task_assignment_id, verilme_tarihi: g.created_at, baslik: g.title, personel: g.assigned_to_name, atayan: g.assigned_by_name,
          gorev_turu: !g.recurring_schedule ? 'tek_seferlik' : hatirlatmaMi(g) ? 'hatirlatma' : 'devamli_gunluk',
          durum, degerlendirme: degerlendir(g, durum),
          firma: g.firm_name, oncelik: g.priority, son_tarih: g.due_date, tamamlanma: g.completed_at,
          okundu: Boolean(g.acknowledged_at), notsuz_tamamlandi: g.status === 'completed' && icerikBos(g.staff_notes),
          giden_arama_kaydi: gidenAramaMi(g.title) ? (aramaSayisi.get(`${g.assigned_to}|${gun}`) || 0) : null,
          sablon_kaydi: g.recurring_schedule && hatirlatmaMi(g) ? (sablonKaydi.get(`${g.assigned_to}|${gun}`) || 0) : null,
          aciklama: String(g.description || '').slice(0, 300), personel_notu: String(g.staff_notes || '').slice(0, 500),
          ek_sayisi: liste(g.attachments).length,
        };
      });

      // "Gerçekten yapılmadı" = süresi geçmiş, işaretlenmemiş ve yukarıdaki açıklamalardan hiçbirine girmeyen görev.
      const yapildiMi = (g) => g.degerlendirme.endsWith('tamamlandi');
      const yapilmadiMi = (g) => g.degerlendirme === 'yapilmadi_suresi_gecti';
      const ayriDegerlendirilen = (g) => !yapildiMi(g) && !yapilmadiMi(g) && !['bekliyor', 'iptal'].includes(g.degerlendirme);
      const sayim = (grup) => grup.reduce((m, g) => { m[g.degerlendirme] = (m[g.degerlendirme] || 0) + 1; return m; }, {});
      const turAdi = { tek_seferlik: 'tek_seferlik', devamli_gunluk: 'devamli', hatirlatma: 'devamli' };

      const personelOzeti = [...gorevler.reduce((m, g) => {
        const p = m.get(g.personel) || { personel: g.personel, toplam: 0, gercekten_yapilmadi: 0, tek_seferlik: {}, devamli: {}, okunmadi: 0, notsuz_tamamlandi: 0 };
        p.toplam += 1;
        if (yapilmadiMi(g)) p.gercekten_yapilmadi += 1;
        const kova = p[turAdi[g.gorev_turu]];
        kova[g.degerlendirme] = (kova[g.degerlendirme] || 0) + 1;
        if (!g.okundu && !yapildiMi(g)) p.okunmadi += 1;
        if (g.notsuz_tamamlandi) p.notsuz_tamamlandi += 1;
        m.set(g.personel, p);
        return m;
      }, new Map()).values()].sort((a, b) => b.gercekten_yapilmadi - a.gercekten_yapilmadi || b.okunmadi - a.okunmadi || a.personel.localeCompare(b.personel, 'tr'));

      const yaz = (o) => Object.entries(o).map(([ad, n]) => `${ad} (${n})`);
      const baslikOzeti = [...gorevler.reduce((m, g) => {
        const b = m.get(g.baslik) || { baslik: g.baslik, gorev_turu: g.gorev_turu, toplam: 0, yapan: {}, yapmayan: {}, bekleyen: {}, ayri_degerlendirilen: {} };
        b.toplam += 1;
        if (yapildiMi(g)) b.yapan[g.personel] = (b.yapan[g.personel] || 0) + 1;
        else if (yapilmadiMi(g)) b.yapmayan[g.personel] = (b.yapmayan[g.personel] || 0) + 1;
        else if (g.degerlendirme === 'bekliyor') b.bekleyen[g.personel] = (b.bekleyen[g.personel] || 0) + 1;
        else if (ayriDegerlendirilen(g)) {
          const k = `${g.personel} · ${g.degerlendirme}`;
          b.ayri_degerlendirilen[k] = (b.ayri_degerlendirilen[k] || 0) + 1;
        }
        m.set(g.baslik, b);
        return m;
      }, new Map()).values()]
        .map((b) => ({ ...b, yapan: yaz(b.yapan), yapmayan: yaz(b.yapmayan), bekleyen: yaz(b.bekleyen), ayri_degerlendirilen: yaz(b.ayri_degerlendirilen) }))
        .sort((a, b) => b.yapmayan.length - a.yapmayan.length || b.toplam - a.toplam);

      d.bolumler.personel_ozeti = personelOzeti;
      d.bolumler.gorev_basliklari = baslikOzeti;
      d.bolumler.gorevler = gorevler;
      api.son = d;

      const tekSeferlik = gorevler.filter((g) => g.gorev_turu === 'tek_seferlik');
      const devamli = gorevler.filter((g) => g.gorev_turu !== 'tek_seferlik');
      return {
        tur: 'gorev', baslangic: bas, bitis: bit, kapsam_notu: d.kapsam_notu || null, toplam_gorev: gorevler.length,
        gercekten_yapilmadi: gorevler.filter(yapilmadiMi).length,
        tek_seferlik: { toplam: tekSeferlik.length, ...sayim(tekSeferlik) },
        devamli_gunluk: { toplam: devamli.length, ...sayim(devamli) },
        okunmadi: gorevler.filter((g) => !g.okundu && !yapildiMi(g)).length,
        notsuz_tamamlandi: gorevler.filter((g) => g.notsuz_tamamlandi).length,
        // En son verilenden eskiye: yönetici önce yeni verdiği görevlerin akıbetini görür.
        son_verilen_20: gorevler.slice(0, 20).map((g) => `${tarih(g.verilme_tarihi)} · ${g.personel} · ${g.baslik.slice(0, 60)} · ${g.gorev_turu} · ${g.degerlendirme}${!g.okundu && !yapildiMi(g) ? ' · okunmadı' : ''}${g.notsuz_tamamlandi ? ' · notsuz' : ''}${g.giden_arama_kaydi ? ` · o gün ${g.giden_arama_kaydi} arama` : ''}${g.sablon_kaydi ? ` · şablonda ${g.sablon_kaydi} firma kaydı` : ''}`),
        personel_ozeti: personelOzeti,
        en_cok_yapilmayan_20: baslikOzeti.slice(0, 20).map((b) => ({
          baslik: b.baslik, gorev_turu: b.gorev_turu, toplam: b.toplam, yapmayan: b.yapmayan,
          ayri_degerlendirilen: b.ayri_degerlendirilen, bekleyen: b.bekleyen, yapan_sayisi: b.yapan.length,
        })),
        aktif_devamli_sablonlar: d.bolumler.aktif_devamli_sablonlar,
        okunamayanlar: d.okunamayanlar,
        detay: "Görev görev kanıt için: __digico.oku('gorevler', 0); başlık bazında: __digico.oku('gorev_basliklari', 0)",
      };
    },

    // Prim denetimi: Reklam personelinin prim skoru (baraj, ölçüt ölçüt kaybedilen puan ve eksik
    // adetler, geçen aya göre değişim) ve Pazarlama personelinin kademeli satış primi durumu.
    // Liste önbelleğini kullanır (list_cache=1): önbelleksiz çağrı 60–80 sn sürüyor.
    async primDenetimi({ ay, yil } = {}) {
      await yoneticiKontrol();
      const bugunTarih = bugun();
      yil = Number(yil) || Number(bugunTarih.slice(0, 4));
      ay = Number(ay) || Number(bugunTarih.slice(5, 7));
      const [oncekiYil, oncekiAy] = ay === 1 ? [yil - 1, 12] : [yil, ay - 1];
      const ayBas = `${yil}-${String(ay).padStart(2, '0')}-01`;
      const d = yeniDosya('prim', `${yil}-${ay}`, ayBas, ayBas);
      // Panel kuralı (views_performance.py): baraj Eylül 2026'dan itibaren 50, Mayıs–Ağustos 2026 45, öncesi 25.
      const baraj = (yil > 2026 || (yil === 2026 && ay >= 9)) ? 50 : (yil === 2026 && ay >= 5) ? 45 : 25;

      const personel = liste(await get('/api/staff/')).filter((s) => s.is_active !== false);
      const birim = (s) => norm(`${s.role} ${s.department}`);
      const reklamcilar = personel.filter((s) => /reklam/.test(birim(s)));
      const pazarlamacilar = personel.filter((s) => /pazarlama/.test(birim(s)));

      const skorlariGetir = async (y, m) => liste(await get('/api/performance/scores/', {
        month: m, year: y, staff_ids: reklamcilar.map((s) => s.staff_id).join(','), summary: 1, list_cache: 1,
      }));
      let buAy = [];
      let gecenAy = [];
      await bolum(d, 'reklam_kaynak', async () => {
        if (!reklamcilar.length) return { personel: 0 };
        [buAy, gecenAy] = await Promise.all([skorlariGetir(yil, ay), skorlariGetir(oncekiYil, oncekiAy)]);
        return { personel: reklamcilar.length, bu_ay: buAy.length, gecen_ay: gecenAy.length };
      });
      const gecenSkor = new Map(gecenAy.map((r) => [String(r.staff_id), Number(r.total_score) || 0]));

      // Ölçüt detaylarındaki "x_count / x_target" çiftlerinden ve bilinen alanlardan eksik adetleri çıkarır.
      const eksikler = (detay) => {
        const sonuc = [];
        if (!detay || typeof detay !== 'object') return sonuc;
        for (const [anahtarE, deger] of Object.entries(detay)) {
          const m = anahtarE.match(/^(.*)_count$/);
          const hedef = m && detay[`${m[1]}_target`];
          if (m && typeof deger === 'number' && typeof hedef === 'number' && hedef > deger) sonuc.push(`${m[1]}: ${deger}/${hedef} (${hedef - deger} eksik)`);
        }
        if (typeof detay.retention_rate === 'number' && typeof detay.retention_target === 'number' && detay.retention_rate < detay.retention_target) {
          sonuc.push(`firma tutma oranı %${detay.retention_rate} / hedef %${detay.retention_target} (giden ${detay.giden_firmalar ?? '-'})`);
        }
        if (typeof detay.gelen_firmalar === 'number' && typeof detay.required_gelen === 'number' && detay.gelen_firmalar < detay.required_gelen) {
          sonuc.push(`telafi için gelen firma ${detay.gelen_firmalar}/${detay.required_gelen}`);
        }
        if (Array.isArray(detay.missing) && detay.missing.length) sonuc.push(`eksik rapor ${detay.missing.length}`);
        if (Array.isArray(detay.late) && detay.late.length) sonuc.push(`geç rapor ${detay.late.length}`);
        if (Array.isArray(detay.incomplete_other_tasks) && detay.incomplete_other_tasks.length) sonuc.push(`tamamlanmamış diğer görev ${detay.incomplete_other_tasks.length}`);
        return sonuc;
      };

      const reklam = buAy.filter((r) => r.status !== 'no_firms').map((r) => {
        const kriterler = Object.entries(r.criteria || {}).map(([olcut, k]) => ({
          olcut, agirlik: k.weight, puan: k.score, yuzde: k.percentage,
          kaybedilen_puan: Math.max(0, (Number(k.weight) || 0) - (Number(k.score) || 0)), eksikler: eksikler(k.details),
        })).sort((a, b) => b.kaybedilen_puan - a.kaybedilen_puan);
        const skor = Number(r.total_score) || 0;
        const onceki = gecenSkor.has(String(r.staff_id)) ? gecenSkor.get(String(r.staff_id)) : null;
        const kalan = Math.max(0, baraj - skor);
        return {
          staff_id: r.staff_id, personel: r.staff_name, skor, baraj, baraja_kalan: kalan,
          durum: kalan === 0 ? 'baraji_gecti' : kalan <= 10 ? 'baraja_cok_yakin' : kalan <= 20 ? 'baraja_yakin' : 'barajin_uzaginda',
          cift_prim_uygun: Boolean(r.double_premium_eligible), panel_durumu: r.status,
          gecen_ay_skor: onceki, degisim: onceki === null ? null : Math.round((skor - onceki) * 10) / 10,
          veri_eski: Boolean(r.is_stale), hesaplaniyor: Boolean(r.snapshot_pending),
          en_cok_puan_kaybettigi: kriterler.filter((k) => k.kaybedilen_puan > 0).slice(0, 4), kriterler,
        };
      }).sort((a, b) => a.baraja_kalan - b.baraja_kalan || b.skor - a.skor);

      let pazarlama = [];
      await bolum(d, 'pazarlama_kaynak', async () => {
        if (!pazarlamacilar.length) return { personel: 0 };
        const r = await get('/api/marketing/sales/summary-batch/', { staff_ids: pazarlamacilar.map((s) => s.staff_id).join(','), month: ay, year: yil });
        const sonuclar = (r && r.results) || {};
        pazarlama = pazarlamacilar.map((s) => {
          const x = sonuclar[s.staff_id] || sonuclar[String(s.staff_id)];
          if (!x) return null;
          const sonraki = x.next_bonus && x.next_bonus.threshold;
          return {
            staff_id: s.staff_id, personel: s.name, toplam_satis: x.total_sales,
            mevcut_kademe: x.current_bonus ? `%${x.current_bonus.percentage} (${x.current_bonus.threshold_formatted} ₺ eşiği)` : 'henüz kademe yok',
            sonraki_kademe: x.next_bonus ? `%${x.next_bonus.percentage} (${x.next_bonus.threshold_formatted} ₺)` : null,
            sonraki_kademeye_kalan: x.remaining_amount, ilerleme_yuzde: x.progress_percentage,
            durum: !sonraki ? 'en_ust_kademe' : x.progress_percentage >= 85 ? 'kademeye_cok_yakin' : x.progress_percentage >= 60 ? 'kademeye_yakin' : 'kademeye_uzak',
            uc_aylik_sonraki_odul: x.three_month_next_bonus ? `${x.three_month_next_bonus.reward} (${x.three_month_next_bonus.threshold_formatted} ₺)` : null,
            uc_aylik_odule_kalan: x.three_month_remaining_amount,
          };
        }).filter(Boolean).sort((a, b) => (b.ilerleme_yuzde || 0) - (a.ilerleme_yuzde || 0));
        return { personel: pazarlamacilar.length };
      });

      d.bolumler.reklam = reklam;
      d.bolumler.pazarlama = pazarlama;
      api.son = d;
      const sonGun = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
      const cariAy = yil === Number(bugunTarih.slice(0, 4)) && ay === Number(bugunTarih.slice(5, 7));
      return {
        tur: 'prim', ay: `${ay}.${yil}`, baraj, ayin_kalan_gunu: cariAy ? sonGun - Number(bugunTarih.slice(8, 10)) : null,
        reklam: reklam.map(({ kriterler, ...ozetR }) => ozetR),
        pazarlama, okunamayanlar: d.okunamayanlar,
        detay: "Ölçüt ölçüt tüm puanlar için: __digico.oku('reklam', 0)",
      };
    },

    // Portföy genelinde ayrılma riski taraması. Panelde resmi bir risk alanı kullanılmadığı için
    // sinyaller firma kartından, muhasebeden, gelir riski panosundan, memnuniyet aramalarından ve
    // reklam personelinin aylık şablondaki müşteri görüşme notlarından toplanıp puanlanır.
    async riskTaramasi({ ay, yil } = {}) {
      await yoneticiKontrol();
      const bugunTarih = bugun();
      yil = Number(yil) || Number(bugunTarih.slice(0, 4));
      ay = Number(ay) || Number(bugunTarih.slice(5, 7));
      const [oncekiYil, oncekiAy] = ay === 1 ? [yil - 1, 12] : [yil, ay - 1];
      const ayBas = `${yil}-${String(ay).padStart(2, '0')}-01`;
      const ayBit = gunEkle(ay === 12 ? `${yil + 1}-01-01` : `${yil}-${String(ay + 1).padStart(2, '0')}-01`, -1);
      const d = yeniDosya('risk', `${yil}-${ay}`, ayBas, ayBit);

      const firmalar = liste(await get('/api/firms/', { all: 'true', lite: 'true' }));
      const firmaBilgi = new Map(firmalar.map((f) => [String(f.firm_id), f]));
      const anahtar = (s) => norm(s).replace(/[^a-z0-9]/g, '');
      const adla = new Map(firmalar.map((f) => [anahtar(f.name), String(f.firm_id)]));
      const adaGoreBul = (ad) => {
        const k = anahtar(ad);
        if (!k) return null;
        if (adla.has(k)) return adla.get(k);
        if (k.length < 5) return null;
        for (const [fk, id] of adla) if (fk.length >= 5 && (fk.includes(k) || k.includes(fk))) return id;
        return null;
      };

      const risk = new Map();
      const ekle = (id, ad, sinyal) => {
        const key = id ? String(id) : `ad:${ad}`;
        const f = id ? firmaBilgi.get(String(id)) : null;
        const kayit = risk.get(key) || {
          firm_id: id ? Number(id) : null, firma: (f && f.name) || ad,
          sorumlu: (f && f.primary_staff_name) || null, panel_durumu: (f && f.status) || null, sinyaller: [],
        };
        kayit.sinyaller.push(sinyal);
        risk.set(key, kayit);
      };

      for (const f of firmalar.filter((x) => x.status === 'AKTIF' && x.calismama_durumu)) {
        const ulasilamiyor = /ulasilam|donus yapmiyor|kapatil/.test(norm(f.calismama_neden));
        ekle(f.firm_id, f.name, {
          tur: 'calismiyor', agirlik: ulasilamiyor ? 3 : 1, kaynak: 'Firma kartı (çalışmama durumu)',
          kanit: `${f.calismama_durumu}: ${f.calismama_neden || '-'}`,
        });
      }

      await bolum(d, 'muhasebe_durumlari', async () => {
        const sayilar = {};
        for (const [yy, aa] of [[oncekiYil, oncekiAy], [yil, ay]]) {
          const odemeler = liste((await get('/api/accounting/payments/all-firms-table/', { month: aa, year: yy })).payments);
          sayilar[`${yy}-${aa}`] = odemeler.reduce((m, s) => { const k = s.firm_status || '-'; m[k] = (m[k] || 0) + 1; return m; }, {});
          for (const s of odemeler) {
            const id = s.firm != null ? String(s.firm) : adaGoreBul(s.firm_name);
            const durum = String(s.firm_status || '');
            const kaynak = `Muhasebe ödeme tablosu ${aa}.${yy}`;
            if (/gitmek_isteyen/.test(durum)) {
              ekle(id, s.firm_name, { tur: 'muhasebe_gitmek_istiyor', agirlik: 5, kaynak, kanit: 'Ödeme durumu: gitmek isteyenler' });
            } else if (/giden/.test(durum) && id && firmaBilgi.has(id) && firmaBilgi.get(id).status === 'AKTIF') {
              ekle(id, s.firm_name, { tur: 'muhasebe_giden_panelde_aktif', agirlik: 5, kaynak, kanit: 'Muhasebede "giden firmalar", firma kartında hâlâ AKTIF' });
            }
            const tarihSayisi = String(s.payment_when || '').split('|').filter((x) => x.trim()).length;
            if (s.is_postponed && tarihSayisi >= 2) {
              ekle(id, s.firm_name, { tur: 'odeme_erteleme', agirlik: tarihSayisi >= 3 ? 2 : 1, kaynak, kanit: `Ödeme tarihi ${tarihSayisi} kez belirlenmiş: ${s.payment_when}` });
            }
          }
        }
        return sayilar;
      });

      await bolum(d, 'gelir_riski', async () => {
        const r = await get('/api/dashboard/revenue-risk/');
        let listelenen = 0;
        for (const s of liste(r.staff)) {
          for (const f of liste(s.firms)) {
            if (f.bucket === 'takipte') continue;
            listelenen += 1;
            const roas = liste(f.recent_roas).map((x) => `${String(x.date).slice(5)}: ${x.roas ?? '-'}`).join(', ');
            // Sadece bütçe aşımı (ROAS iyi) ayrılma açısından zayıf sinyaldir.
            const sadeceButce = liste(f.reasons).length > 0 && liste(f.reasons).every((x) => x === 'budget_exceeded');
            ekle(f.firm_id, f.name, {
              tur: 'gelir_riski', agirlik: f.bucket === 'mudahale_yok' && !sadeceButce ? 2 : 1, kaynak: 'Gelir riski panosu',
              kanit: `${f.bucket} (${f.note}); sebep: ${liste(f.reasons).join(', ')}; ${f.streak_days} gün seri; son ROAS ${roas}`,
            });
          }
        }
        return { sayilar: r.counts, listelenen };
      });

      await bolum(d, 'memnuniyet_aramalari', async () => {
        let taranan = 0;
        for (const [yy, aa] of [[oncekiYil, oncekiAy], [yil, ay]]) {
          const aramalar = liste(await get('/api/accounting/satisfaction-calls/', { month: aa, year: yy }));
          taranan += aramalar.length;
          for (const a of aramalar) {
            const yorum = [a.kampanya_yorum, a.rapor, a.notes].filter(Boolean).join(' ').trim();
            const olumsuzIfade = /basarisiz|beklentimin (cok )?altinda|memnun degil|memnuniyetsiz|istedigim duzeyde degil|verim alamad/.test(norm(yorum));
            const olumsuz = (a.rating != null && a.rating <= 2) || (a.genel_memnuniyet != null && a.genel_memnuniyet <= 6)
              || norm(a.tavsiye) === 'hayir' || (a.memnuniyet && norm(a.memnuniyet) !== 'memnun') || olumsuzIfade;
            if (!olumsuz) continue;
            ekle(adaGoreBul(a.instagram), a.instagram, {
              tur: 'memnuniyet_olumsuz', agirlik: 3, kaynak: 'Muhasebe memnuniyet araması', tarih: a.arama_tarihi || a.guncel_tarih,
              kanit: `puan ${a.rating ?? '-'}, genel ${a.genel_memnuniyet ?? '-'}, tavsiye ${a.tavsiye || '-'}, kampanya sonucu ${a.kampanya_sonuclari || '-'}${yorum ? ` — "${yorum.slice(0, 200)}"` : ''}`,
            });
          }
        }
        return { taranan_kayit: taranan };
      });

      // Sadece müşteriyle yapılan görüşmelerin yazıldığı alanlar taranır. Tanışma notları (eski ajans
      // şikâyetleri) ve SM analiz metinleri ("kategorilere ayrılmış", "yanıtsız bırakılmış") yanlış alarm üretir.
      const MUSTERI_ALANI = /^(musteriyle_gorusuldu_mu|musteri_istekleri|gorusme_\d+|goruntulu_.*|cozum|beklenti|gidip_gelen_tarihler|iletisime_.*)$/;
      const SM_ALANI = /^(sm_kontrol_.*|sosyal_medya_kontrolu_.*)$/;
      const DESENLER = [
        { tur: 'acik_ayrilma', agirlik: 5, re: /ayrilmak ist|ayrilmay[ia] karar|ayrilacag|gitmek ist|gitmek uzere|hizmet(e|ine) ara|devam etme (taraftari|niyet)|devam etmek istemi|devam etmeyece|calismayi (birak|sonland|bitir)|isi (tamamen )?birakmak|sozlesme(yi|miz)? (feshe?|iptal|yenilemey|uzatmay)/ },
        // Reklama ara vermek, satışların düşmesi, "satış yok" ve memnuniyetsizlik de yönetici için risktir.
        { tur: 'reklam_durdurma', agirlik: 4, re: /reklam(lar)?a ara|ara vermek|ara verme|reklam cikilmasin|reklam cikilmasini istemi|(reklam|kampanya|surec)[a-z]*( [a-z]+){0,4} durdurmak|durdurmak (ve|,).{0,60}(ist|talep)|ilerleyen donemde (tekrar|yeniden) degerlendir|sureci dondur|tum reklam(lar)?(i|in)? (kapat|durdur)/, haric: /yerine|butce[a-z]* (aktar|kaydir)|aktarmak|verimsiz|maliyetli|pahali|dusuk performans|performansi dusuk|kazanan|optimizasyon/ },
        // Belirli reklamların yenisiyle değiştirilmek üzere kapatılması reklama ara vermek değildir.
        { tur: 'reklam_durdurma', agirlik: 4, re: /reklam(lar)?(in|i)? (durdurul|kapatil)ma(sini|si) (ist|talep)|reklamlari? kapatilsin/, haric: /bazi|numarali|sirad|yerine|yeni (urun|cekim|kreatif|reklam|icerik|video)|revize|guncelle|\d\.? (ve|ile|,)/ },
        { tur: 'memnuniyetsizlik', agirlik: 4, re: /memnun degil|memnun olmad|memnuniyetsiz|sikayetci|sikayet etti|beklentinin (cok )?altinda|guveni(ni)? kaybet|verim alamad/, haric: /(herhangi bir|hicbir) (memnuniyetsizlik|sikayet)|(memnuniyetsizli|sikayet)[a-z]* (veya [a-z ]{0,25})?(yok|bulunmuyor|olmadi)|memnuniyetsizlik yasanan noktalar/ },
        { tur: 'satis_dusus', agirlik: 3, re: /satis(lar)?(i|in)? (dus|azal|yavasla|geriled)|satis ivmesi.{0,60}yavasla|eskisi kadar sat|satis(lar)? durdu|siparis(ler)?(i|in)? (dus|azal)/ },
        // Firmaya mesaj atan alıcıların indirim istemesi fiyat baskısı değildir.
        { tur: 'fiyat_baskisi', agirlik: 2, re: /hizmet bedel(in)?de indirim|fiyat teklifi|indirim (talep|isted|rica)|taksit(lendirme)? (talep|isted)|butce(nin|yi)? (azalt|dusur)/, haric: /(musteri|kullanici|takipci|alici|gelen mesaj)[a-z]{0,8}.{0,40}indirim|indirim (talep|isted|rica) eden/ },
        // Reklamı henüz başlamamış firmalarda "satış yok" risk sinyali değildir.
        { tur: 'satis_yok', agirlik: 2, re: /satis yok|satis olmadi|satis gelmedi|satis yapilmadi|hic satis|satisa don(mu)?yor|satisa donmedi|kargo cikisi (olmadi|gerceklesmedi)|kargo cikmadi|siparis (gelmedi|yok)/, girdiHaric: /surec(i)? (henuz )?baslamad|kurulum|bugun geldi|yeni geldi|reklam(lar)? (henuz )?(baslamad|acilmad|cikilmad)|hesabina erisilemedi|reklam yok/ },
      ];
      const SM_DESENI = { tur: 'surec_durdu', agirlik: 3, re: /surec durduruldu|musteri ayrildi|calismayi birakt/ };
      const ONCEKI_AJANS = /onceki (ajans|calistig)|daha once(si(nde)?)? .{0,40}ajans|eski ajans|baska (bir )?ajans(la|tan)|ajans(i)?(y)?la calis(ildi|mis|ma beklentisi)|ajans tarafindan .{0,60}vaat/;

      await bolum(d, 'sablon_notlari', async () => {
        const personel = liste(await get('/api/staff/')).filter((s) => /reklam/.test(norm(`${s.role} ${s.department}`)) && s.is_active !== false);
        const taranan = [];
        const atlanan = [];
        await sinirli(personel.map((s) => async () => {
          let veri;
          try {
            veri = await get('/api/monthly-template/data/', { staff_id: s.staff_id, month: ay, year: yil });
          } catch (e) {
            if (e.message === 'OTURUM_YOK') throw e;
            atlanan.push(`${s.name}: ${e.message}`);
            return;
          }
          taranan.push(s.name);
          for (const f of liste(veri.firms)) {
            const gorulen = new Set();
            for (const [alan, deger] of Object.entries(f)) {
              if (typeof deger !== 'string' || deger.length < 8) continue;
              const desenler = MUSTERI_ALANI.test(alan) ? DESENLER : SM_ALANI.test(alan) ? [SM_DESENI] : null;
              if (!desenler) continue;
              for (const g of girdilereBol(deger, ayBas)) {
                if (g.tarih && (g.tarih < ayBas || g.tarih > ayBit)) continue;
                const n = norm(g.metin);
                for (const desen of desenler) {
                  const m = n.match(desen.re);
                  if (!m) continue;
                  const pencere = n.slice(Math.max(0, m.index - 120), m.index + 120);
                  if (desen.tur !== 'satis_yok' && ONCEKI_AJANS.test(pencere)) continue;
                  if ((desen.haric && desen.haric.test(pencere)) || (desen.girdiHaric && desen.girdiHaric.test(n))) continue;
                  const imza = `${desen.tur}|${n.slice(0, 80)}`;
                  if (gorulen.has(imza)) continue;
                  gorulen.add(imza);
                  ekle(f.firm_id, f.firm_name, {
                    tur: desen.tur, agirlik: desen.agirlik, kaynak: `Aylık şablon · ${alan} · ${s.name}`, tarih: g.tarih,
                    kanit: g.metin.slice(Math.max(0, m.index - 160), m.index + 220).replace(/\s+/g, ' ').trim(),
                  });
                }
              }
            }
          }
        }), 4);
        return { taranan_personel: taranan, atlanan };
      });

      const PUAN_SINIRI = { acik_ayrilma: 2, reklam_durdurma: 2, memnuniyetsizlik: 2, satis_dusus: 2, satis_yok: 3, memnuniyet_olumsuz: 2 };
      const firmaListesi = [...risk.values()].map((k) => {
        const tekil = [];
        const gorulen = new Set();
        for (const s of k.sinyaller) {
          const imza = `${s.tur}|${s.kanit}`;
          if (!gorulen.has(imza)) { gorulen.add(imza); tekil.push(s); }
        }
        // Aynı not günlük şablonda her gün tekrarlandığı için bir türden sinyal firma başına
        // sınırlı sayıda puanlanır; kanıt olarak da türü başına en fazla 3 kayıt gösterilir.
        tekil.sort((a, b) => b.agirlik - a.agirlik || String(b.tarih || '').localeCompare(String(a.tarih || '')));
        const sayac = {};
        const kanitlar = [];
        let skor = 0;
        for (const s of tekil) {
          sayac[s.tur] = (sayac[s.tur] || 0) + 1;
          if (sayac[s.tur] <= (PUAN_SINIRI[s.tur] || 1)) skor += s.agirlik;
          if (sayac[s.tur] <= 3) kanitlar.push(s);
        }
        return {
          ...k, skor, seviye: skor >= 5 ? 'yuksek' : skor >= 3 ? 'orta' : 'dusuk',
          sinyaller: kanitlar, gosterilmeyen_tekrar: tekil.length - kanitlar.length,
        };
      })
        .filter((k) => k.skor >= 2 && (!k.panel_durumu || k.panel_durumu === 'AKTIF'))
        .sort((a, b) => b.skor - a.skor);

      d.bolumler.firmalar = firmaListesi;
      api.son = d;
      const say = (sv) => firmaListesi.filter((k) => k.seviye === sv).length;
      return {
        tur: 'risk', ay: `${ay}.${yil}`, aktif_firma: firmalar.filter((f) => f.status === 'AKTIF').length,
        seviyeler: { yuksek: say('yuksek'), orta: say('orta'), dusuk: say('dusuk') },
        kapsam: {
          muhasebe_durumlari: d.bolumler.muhasebe_durumlari, gelir_riski: d.bolumler.gelir_riski,
          memnuniyet_aramalari: d.bolumler.memnuniyet_aramalari, sablon_notlari: d.bolumler.sablon_notlari,
        },
        okunamayanlar: d.okunamayanlar,
        ilk_40: firmaListesi.slice(0, 40).map((k) => ({
          firm_id: k.firm_id, firma: k.firma, sorumlu: k.sorumlu, skor: k.skor, seviye: k.seviye,
          sinyaller: [...new Set(k.sinyaller.map((s) => s.tur))].join(', '),
          en_guclu_kanit: `${k.sinyaller[0].tarih ? `${k.sinyaller[0].tarih} · ` : ''}${k.sinyaller[0].kanit.slice(0, 180)}`,
        })),
        detay: "Tüm kanıtlar için: __digico.oku('firmalar', 0)",
      };
    },

    // Tarayıcı aracının komut süresi sınırlı (yaklaşık 45 sn). Panelin bazı uçları (görüşme planı,
    // toplantı kayıtları, prim skorları) 10–80 sn sürdüğü için yavaş işlemler arka planda başlatılır,
    // sonuç ayrıca alınır: baslat('gorusmeDenetimi', bas, bit) → sonuc('gorusmeDenetimi').
    isler: {},

    baslat(islem, ...argumanlar) {
      if (typeof api[islem] !== 'function' || ['baslat', 'sonuc'].includes(islem)) {
        return { durum: 'hata', hata: `Böyle bir işlem yok: ${islem}` };
      }
      const mevcut = api.isler[islem];
      if (mevcut && mevcut.durum === 'calisiyor') {
        return { durum: 'calisiyor', baslangic: mevcut.baslangic, not: `Zaten çalışıyor; sonuc('${islem}') ile kontrol edin.` };
      }
      const is = { durum: 'calisiyor', baslangic: new Date().toISOString(), sonuc: null, hata: null };
      api.isler[islem] = is;
      api[islem](...argumanlar)
        .then((sonuc) => { is.sonuc = sonuc; is.durum = 'bitti'; })
        .catch((e) => { is.hata = String(e.message || e); is.durum = 'hata'; });
      return { durum: 'basladi', not: `10 saniye kadar sonra sonuc('${islem}') çalıştırın.` };
    },

    sonuc(islem) {
      const is = api.isler[islem];
      if (!is) return { durum: 'baslatilmadi', not: `Önce baslat('${islem}', ...) çalıştırın.` };
      if (is.durum === 'calisiyor') {
        return { durum: 'calisiyor', gecen_sn: Math.round((Date.now() - new Date(is.baslangic).getTime()) / 1000) };
      }
      if (is.durum === 'hata') return { durum: 'hata', hata: is.hata };
      return { durum: 'bitti', ...is.sonuc };
    },

    riskBaslat(secenekler = {}) { return api.baslat('riskTaramasi', secenekler); },
    riskSonucu() { return api.sonuc('riskTaramasi'); },

    // Görüşme denetimi: plan tablosundaki tanışma, 1. sesli, 2. sesli ve görüntülü görüşmelerden
    // aralığa düşenleri toplantı kayıtlarının içeriğiyle eşleştirir. "Doldurulmuş" görünüp notunda
    // görüşmenin yapılmadığı yazanları, içeriği boş olanları ve eksik kalanları personel bazında çıkarır.
    // Yöneticiler güncel durumu soruyor: tarih verilmezse son 30 gün denetlenir, daha uzun aralık
    // istenirse de yalnızca aralığın son 31 günü alınır. Eski ayların kayıtları hesaba katılmaz.
    async gorusmeDenetimi(bas, bit) {
      await yoneticiKontrol();
      const bugunTarih = bugun();
      bit = tarih(bit) || bugunTarih;
      if (bit > bugunTarih) bit = bugunTarih;
      bas = tarih(bas) || gunEkle(bit, -30);
      const kirpildi = bas < gunEkle(bit, -31);
      if (kirpildi) bas = gunEkle(bit, -30);
      const d = yeniDosya('gorusme', 'tum', bas, bit);
      bas = d.baslangic; bit = d.bitis;
      if (kirpildi) d.kapsam_notu = `İstenen aralık 31 günden uzundu; yalnızca son 31 gün (${bas} – ${bit}) denetlendi.`;
      const TURLER = {
        tanisma: { etiket: 'Tanışma toplantısı', kayit: ['tanisma', 'sm_tanisma'] },
        sesli_1: { etiket: '1. Sesli görüşme', kayit: ['sesli_gorusme_1'] },
        sesli_2: { etiket: '2. Sesli görüşme', kayit: ['sesli_gorusme_2'] },
        goruntulu: { etiket: 'Görüntülü görüşme', kayit: ['goruntulu_gorusme'] },
      };
      // Notunda görüşmenin aslında yapılmadığını söyleyen ifadeler.
      const YAPILMADI = /acmadi|acmiyor|acilmadi|acilmiyor|ulasilam|ulasamad|donus (yapmadi|saglanmadi|alinamadi|yok)|donuste bulunulmadi|cevap vermedi|telefonu kapali|yapilamadi|gerceklesmedi|gerceklestirilemedi|saglanamadi|musait degil|yarina planlandi|(gorusme|toplanti)[a-z]* .{0,40}(planlandi|ertelendi|iptal)|sonraki gune ertelendi|tarih(i)? (belirlenecek|verilecek)|(yarin|sonra|haftaya|daha sonra) (yapilacak|gorusulecek|aranacak|planlanacak)/;
      // Görüşmenin gerçekleştiğini söyleyen ifadeler. Notlar gün gün eklendiği için "yarın aranacak …
      // 8 eylül: görüşme sağlandı" gibi önce ertelenip sonra yapılan görüşmeler olur.
      const YAPILDI = /gorusme (saglandi|saglanmistir|saglad(i|ik)|gerceklestirildi|gerceklestirilmistir|gerceklestird(i|ik)|yapildi|yapilmistir|yaptik)|gerceklestirilen gorusme|ile gorusuldu|ile gorusme (saglandi|yapildi|gerceklestirildi)|toplanti(si)? (gerceklestirildi|gerceklestirilmistir|yapildi|yapilmistir|yaptik)|degerlendirmesi (yapildi|gerceklestird|gerceklestirildi)|iletisim saglandi|gorusuldu|konusuldu|bilgi verildi/;
      // Notlara sonradan eklenen girdiler "8 eylül:" ya da "08.09" gibi bir tarihle başlar.
      const TARIH_IFADESI = /\b\d{1,2} (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b|\b\d{1,2}\.\d{1,2}(\.\d{2,4})?\b/;
      const sonEslesme = (re, metin) => {
        let son = -1;
        for (const m of metin.matchAll(new RegExp(re.source, 'g'))) son = m.index;
        return son;
      };
      // Tanışma notları JSON olarak saklanabiliyor ({"notes": ..., "musteriyi_tanimak_sorulari": ...}); düz metne çevir.
      const metneCevir = (v) => {
        const t = temizle(v);
        if (t && typeof t === 'object') {
          return Object.values(t).flat().map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' | ');
        }
        return String(t || '');
      };

      const planSatirlari = [];
      await bolum(d, 'plan', async () => {
        for (const [y, m] of aylar(bas, bit)) {
          const r = await get('/api/firm-tasks/meeting-report-schedule/', { year: y, month: m, scope: 'all' });
          planSatirlari.push(...liste(r.rows));
        }
        return { firma_satiri: planSatirlari.length };
      });

      const kayitlar = [];
      await bolum(d, 'toplanti_kayitlari_ozet', async () => {
        const kBas = gunEkle(bas, -7);
        const kBit = gunEkle(bit, 7) < bugunTarih ? gunEkle(bit, 7) : bugunTarih;
        kayitlar.push(...liste(await get('/api/meeting-logs/', { meeting_date__gte: kBas, meeting_date__lte: kBit })));
        return { kayit: kayitlar.length, aralik: `${kBas} – ${kBit}` };
      });
      const personelAdi = new Map();
      await bolum(d, 'personel_listesi', async () => {
        for (const s of liste(await get('/api/staff/'))) personelAdi.set(String(s.staff_id), s.name);
        return { personel: personelAdi.size };
      });

      const kayitIndeksi = new Map(); // firm|tur -> [kayıt]
      for (const k of kayitlar) {
        const tur = Object.keys(TURLER).find((t) => TURLER[t].kayit.includes(norm(k.meeting_type)));
        if (!tur) continue;
        const anahtarK = `${k.firm}|${tur}`;
        if (!kayitIndeksi.has(anahtarK)) kayitIndeksi.set(anahtarK, []);
        kayitIndeksi.get(anahtarK).push(k);
      }
      const gunFarki = (a, b) => Math.abs((new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86400000);

      const gorusmeler = [];
      for (const satir of planSatirlari) {
        // Panelde deneme amaçlı açılmış kayıtlar denetime girmez.
        if (/^(test|deneme)$/.test(norm(satir.staff_name).trim()) || /^(test|deneme)\b/.test(norm(satir.firm_name).trim())) continue;
        for (const [tur, tanim] of Object.entries(TURLER)) {
          const plan = tarih(satir[tur]);
          if (!plan || plan < bas || plan > bit) continue;
          const isaretli = Boolean(satir[`${tur}_done`]);
          const adaylar = (kayitIndeksi.get(`${satir.firm_id}|${tur}`) || [])
            .map((k) => ({ k, fark: gunFarki(tarih(k.meeting_date), plan) }))
            .filter((x) => x.fark <= 10)
            .sort((a, b) => a.fark - b.fark);
          const kayit = adaylar.length ? adaylar[0].k : null;
          const icerik = kayit ? [metneCevir(kayit.notes), metneCevir(kayit.customer_requests)].filter(Boolean).join(' | ') : '';
          const n = norm(icerik);
          const icerikBos = Boolean(kayit) && n.replace(/[^a-z0-9]/g, '').length < 15;
          // Notta "yapılmadı" ifadesi olsa bile görüşme yapılmış sayılır, eğer:
          // - olumsuz ifadeden sonra tarihli yeni bir girdide görüşmenin yapıldığı yazıyorsa
          //   ("yarın aranacak … 8 eylül: görüşme sağlandı"), ya da
          // - not uzun (ayrıntılı görüşme özeti) ve olumsuz ifade notun başında değilse; bu notlarda
          //   "bütçe … planlandı" gibi gelecek planları geçer. Başta "görüşme gerçekleştirilemedi" yazan
          //   notlar yapılmamış sayılmaya devam eder.
          const olumsuzYer = kayit ? sonEslesme(YAPILMADI, n) : -1;
          const ilkOlumsuzYer = kayit ? n.search(YAPILMADI) : -1;
          const olumluYer = kayit ? sonEslesme(YAPILDI, n) : -1;
          const tarihliSonrakiGirdi = olumluYer > olumsuzYer && TARIH_IFADESI.test(n.slice(olumsuzYer, olumluYer));
          const sonradanYapildi = olumsuzYer >= 0 && (tarihliSonrakiGirdi || (n.length > 400 && ilkOlumsuzYer > 150));
          const yapilmadiDiyor = olumsuzYer >= 0 && !sonradanYapildi;

          let durum;
          if (isaretli) {
            durum = !kayit ? 'isaretli_ama_kayit_bulunamadi'
              : yapilmadiDiyor ? 'isaretli_ama_notta_yapilmadi'
                : icerikBos ? 'isaretli_ama_icerik_bos' : 'yapildi';
          }
          else if (kayit && !icerikBos && !yapilmadiDiyor) durum = 'kayit_var_isaret_yok';
          else durum = plan < bugunTarih ? 'eksik_suresi_gecti' : 'planli';

          gorusmeler.push({
            firma: satir.firm_name, firm_id: satir.firm_id, sorumlu: satir.staff_name, yedek: satir.backup_staff_name,
            gorusme: tanim.etiket, plan_tarihi: plan, isaretli, durum,
            kayit_tarihi: kayit ? tarih(kayit.meeting_date) : null,
            kaydi_giren: kayit ? (personelAdi.get(String(kayit.staff)) || kayit.met_with || null) : null,
            memnuniyet_puani: kayit ? kayit.customer_satisfaction_rating : null,
            musteri_talepleri: kayit ? String(kayit.customer_requests || '').slice(0, 400) : null,
            not: kayit ? metneCevir(kayit.notes).slice(0, 800) : null,
            puan_var_gorusme_yok: Boolean(kayit && kayit.customer_satisfaction_rating && yapilmadiDiyor),
            once_ertelenip_sonra_yapildi: sonradanYapildi,
          });
        }
      }

      const DURUMLAR = ['yapildi', 'kayit_var_isaret_yok', 'isaretli_ama_notta_yapilmadi', 'isaretli_ama_icerik_bos', 'isaretli_ama_kayit_bulunamadi', 'eksik_suresi_gecti', 'planli'];
      const SORUNLU = ['isaretli_ama_notta_yapilmadi', 'isaretli_ama_icerik_bos', 'isaretli_ama_kayit_bulunamadi', 'eksik_suresi_gecti'];
      const personelOzeti = [...gorusmeler.reduce((m, g) => {
        const p = m.get(g.sorumlu) || { sorumlu: g.sorumlu, toplam: 0, ...Object.fromEntries(DURUMLAR.map((x) => [x, 0])), puan_var_gorusme_yok: 0 };
        p.toplam += 1; p[g.durum] += 1;
        if (g.puan_var_gorusme_yok) p.puan_var_gorusme_yok += 1;
        m.set(g.sorumlu, p);
        return m;
      }, new Map()).values()].sort((a, b) => SORUNLU.reduce((t, x) => t + b[x], 0) - SORUNLU.reduce((t, x) => t + a[x], 0));

      d.bolumler.personel_ozeti = personelOzeti;
      d.bolumler.gorusmeler = gorusmeler;
      api.son = d;
      const say = (durum) => gorusmeler.filter((g) => g.durum === durum).length;
      return {
        tur: 'gorusme', baslangic: bas, bitis: bit, kapsam_notu: d.kapsam_notu || null, toplam: gorusmeler.length,
        ...Object.fromEntries(DURUMLAR.map((x) => [x, say(x)])),
        puan_var_gorusme_yok: gorusmeler.filter((g) => g.puan_var_gorusme_yok).length,
        personel_ozeti: personelOzeti,
        sorunlu_ilk_25: gorusmeler.filter((g) => SORUNLU.includes(g.durum))
          .slice(0, 25).map((g) => `${g.durum} · ${g.firma} · ${g.gorusme} · plan ${g.plan_tarihi} · ${g.sorumlu}${g.not ? ` · not: "${g.not.slice(0, 120)}"` : ''}`),
        okunamayanlar: d.okunamayanlar,
        detay: "Görüşme görüşme içerik için: __digico.oku('gorusmeler', 0)",
      };
    },

    // Son çekilen dosyadan bir bölümü 15.000 karakterlik parçalar hâlinde döndürür.
    oku(bolumAdi, parca = 0) {
      const d = api.son;
      if (!d) throw new Error('Önce firmaDosyasi veya personelDosyasi çalıştırın');
      const v = bolumAdi ? d.bolumler[bolumAdi] : d.bolumler;
      if (v === undefined) return { hata: 'Böyle bölüm yok', bolumler: Object.keys(d.bolumler) };
      const metin = JSON.stringify(v, null, 1);
      return {
        bolum: bolumAdi, parca, toplam_parca: Math.max(1, Math.ceil(metin.length / PARCA)),
        veri: metin.slice(parca * PARCA, (parca + 1) * PARCA),
      };
    },

    // Son dosyada kelime arar; eşleşen metinlerin bölüm yolunu ve kısa kesitini döndürür.
    ara(kelime) {
      const d = api.son;
      if (!d) throw new Error('Önce firmaDosyasi veya personelDosyasi çalıştırın');
      const a = norm(kelime);
      const bulunan = [];
      const gez = (v, yol) => {
        if (bulunan.length >= 50) return;
        if (Array.isArray(v)) v.forEach((x, i) => gez(x, `${yol}[${i}]`));
        else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => gez(x, `${yol}.${k}`));
        else if (typeof v === 'string') {
          const i = norm(v).indexOf(a);
          if (i >= 0) bulunan.push({ yol, kesit: v.slice(Math.max(0, i - 120), i + 200) });
        }
      };
      gez(d.bolumler, 'bolumler');
      return bulunan;
    },

    // Dosyada olmayan bir kaynak gerektiğinde tek GET isteği.
    async ham(yol, params) {
      await yoneticiKontrol();
      const metin = JSON.stringify(temizle(await get(yol, params)), null, 1);
      return { toplam_karakter: metin.length, veri: metin.slice(0, PARCA) };
    },
  };

  window.__digico = api;
  return 'yuklendi';
})();
