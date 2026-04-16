# Demo UI

Bu klasor, ExamFlow projesi icin demo amacli hafif arayuzu barindirir.

Mevcut kapsam:

- `/publish` akisini form uzerinden tetikleme
- `/health` ve `/ready` durumlarini gosterme
- backend response bilgisini ekranda sunma

## Dosyalar

- `index.html`: demo ekraninin iskeleti
- `styles.css`: demo arayuzunun stilleri
- `app.js`: API cagrilari ve ekran davranislari

## Lokal kullanim

API'yi ayaga kaldirdiktan sonra bu klasor icinde basit bir statik sunucu calistir:

```powershell
cd C:\examflow-platform\demo-ui
python -m http.server 5500
```

Ardindan tarayicida:

- `http://127.0.0.1:5500`

ekranini ac.

Varsayilan API adresi:

- `http://127.0.0.1:8080`

Bu nedenle demo ekranini kullanmadan once `api-service` ayakta olmalidir.
