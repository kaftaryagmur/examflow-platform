# Demo UI

Bu klasor, ExamFlow sunumu icin React + Vite + Tailwind tabanli demo dashboard arayuzunu barindirir.

Mevcut kapsam:

- `/health` ve `/ready` durumlarini gosterme
- login formu gostermeden demo kullanici session'i olusturma
- JWT ile protected `/publish` akisini tetikleme
- kullaniciya ait `/documents` ve `/exams` kayitlarini listeleme
- Dashboard, Documents ve Exams arasinda navigation saglama
- son API yanitini ve demo akis adimlarini ekranda gosterme

## Lokal kullanim

```powershell
cd C:\examflow-platform\demo-ui
npm install
npm run dev
```

Varsayilan API adresi Vite dev proxy uzerinden gelir:

```text
/api
```

Proxy hedefi:

```text
http://127.0.0.1:8080
```

Demo session akisi API uzerinde `/auth/register` ve `/auth/login` endpoint'lerini kullanir. Bu nedenle `api-service` icin MongoDB ve `JWT_SECRET` ayarlari hazir olmalidir.

## API baglantisi

GKE uzerindeki API servisine lokal port-forward ac:

```powershell
kubectl port-forward service/api-service 8080:80 -n examflow
```

Ardindan UI icinde varsayilan API Base URL degeri kullanilabilir:

```text
/api
```

## Demo dogrulama akisi

1. UI'i `npm run dev` ile ac.
2. API icin `kubectl port-forward` calistir.
3. Dashboard ekraninda `/health` ve `/ready` durumlarini kontrol et.
4. `Demo Baslat` ile otomatik demo kullanici session'i olustur.
5. Dosya sec veya varsayilan demo dosyasi ile `Gonder` butonuna bas.
6. Documents ekraninda yeni document kaydini kontrol et.
7. Exam processing tamamlandiktan sonra Exams ekraninda kaydi kontrol et.

Not: Bu sprintte UI dosyanin binary icerigini upload etmez; backend'in mevcut `/publish` kontratina uygun olarak `documentId`, `fileName` ve `source` alanlari ile document event olusturur.
