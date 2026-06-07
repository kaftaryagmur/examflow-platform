# ExamFlow Data Models

SCRUM-27 kapsaminda temel domain modelleri MongoDB collection yapisina gore tanimlanir.

## Collections

```text
users
documents
exams
activity_events
```

## User

`users` collection'i uygulama kullanicilarini tutar.

| Field | Type | Description |
| --- | --- | --- |
| `_id` | ObjectId | MongoDB primary key |
| `email` | string | Kullanici e-posta adresi |
| `displayName` | string | Arayuzde gorunen kullanici adi |
| `passwordHash` | string | Hashlenmis parola, API response'larinda donmez |
| `status` | string | `active` veya `disabled` |
| `createdAt` | string | UTC RFC3339 olusturma zamani |
| `updatedAt` | string | UTC RFC3339 guncelleme zamani |

## Document

`documents` collection'i kullaniciya ait yuklenen dokumanlari ve islenme durumlarini tutar.

| Field | Type | Description |
| --- | --- | --- |
| `_id` | ObjectId | MongoDB primary key |
| `userId` | ObjectId | Dokuman sahibi kullanici |
| `documentId` | string | Event akisi ve dis istemciler icin dokuman referansi |
| `fileName` | string | Yuklenen dosya adi |
| `fileSize` | int64 | Multipart upload ile gelen dosya boyutu |
| `contentType` | string | Multipart upload ile gelen veya API tarafinda tespit edilen MIME tipi |
| `fileId` | ObjectId | MongoDB GridFS icindeki binary dosya referansi |
| `storageBackend` | string | Dosya binary iceriginin saklandigi backend, su an `gridfs` |
| `fileUrl` | string | Frontend viewer icin JWT korumali binary endpoint path'i |
| `source` | string | `manual`, `demo` gibi kaynak bilgisi |
| `status` | string | `uploaded`, `processing`, `processed`, `failed` |
| `generationPrefs` | object | Upload sirasinda alinan uretim tercihleri (`questionCount`, `difficulty`, `infoCardCount`, `focus`) |
| `processingInfo` | string | Opsiyonel isleme sonucu veya hata ozeti |
| `createdAt` | string | UTC RFC3339 olusturma zamani |
| `updatedAt` | string | UTC RFC3339 guncelleme zamani |

## Exam

`exams` collection'i validation sonucunda olusan sinav state bilgisini tutar.

| Field | Type | Description |
| --- | --- | --- |
| `_id` | ObjectId | MongoDB primary key |
| `userId` | ObjectId | Sinav sahibi kullanici |
| `documentId` | string | Sinavin uretildigi document referansi |
| `title` | string | Opsiyonel sinav basligi |
| `validationResult` | string | `valid`, `invalid`, `passed`, `failed` |
| `status` | string | `draft`, `processing`, `validated`, `published`, `failed` |
| `questions` | array | AI uretimi coktan secmeli sorular (`question`, `options`, `correctAnswer`, `explanation`, `difficulty`, `topic`) |
| `infoCards` | array | AI uretimi calisma kartlari (`title`, `summary`, `keyPoints`) |
| `generationModel` | string | Iceriği ureten Claude model ID'si (or. `claude-opus-4-8`) |
| `generationPrefs` | object | Kullanicinin istedigi uretim tercihleri (`questionCount`, `difficulty`, `infoCardCount`, `focus`) |
| `qualityStatus` | string | Uretilen icerigin kalite sonucu: `passed` veya `failed` |
| `qualityIssues` | array | Kalite kontrolunde bulunan sorunlarin metin listesi (bos ise sorun yok) |
| `createdAt` | string | UTC RFC3339 olusturma zamani |
| `updatedAt` | string | UTC RFC3339 guncelleme zamani |

`questions[]` elemanlari su alt alanlari tasir: `question` (metin), `options` (4 secenek), `correctAnswer` (A/B/C/D), `explanation`, `difficulty` (`easy`/`medium`/`hard`), `topic`. `infoCards[]` elemanlari ise `title`, `summary` ve `keyPoints` (string listesi) tasir. `generationPrefs` ise kullanicinin upload sirasinda sectigi `questionCount`, `difficulty` (`easy`/`medium`/`hard`/`mixed`), `infoCardCount` ve serbest `focus` alanlarini tasir.

## Activity Event

`activity_events` collection'i kullaniciya ait publish ve arka plan islem gecmisini kalici olarak tutar.

| Field | Type | Description |
| --- | --- | --- |
| `_id` | ObjectId | MongoDB primary key |
| `userId` | ObjectId | Event sahibi kullanici |
| `documentId` | string | Eventin bagli oldugu dokuman referansi |
| `eventId` | string | Pub/Sub zincirinde tasinan event correlation id |
| `eventType` | string | `document.received`, `document.processed`, `document.validated`, `exam.generated` gibi olay tipi |
| `status` | string | UI filtresi icin `received`, `published`, `processing`, `processed`, `validated`, `failed` |
| `service` | string | Eventi yazan servis (`api-service`, `worker-service`, `validation-service`, `exam-service`) |
| `message` | string | Kullaniciya okunabilir durum aciklamasi |
| `error` | string | Opsiyonel hata detayi |
| `createdAt` | string | UTC RFC3339 olusturma zamani |

## Relations

```text
User 1 -> N Document
User 1 -> N Exam
User 1 -> N ActivityEvent
Document 1 -> N Exam
Document 1 -> N ActivityEvent
```

MongoDB dokuman modeli kullanildigi icin iliskiler foreign key constraint ile degil, `ObjectId` referanslari ve uygulama seviyesindeki kontrol ile yonetilir. SCRUM-32 kapsaminda bu referanslar ownership kurallariyla guclendirilmistir.

## Ownership Flow

SCRUM-32 kapsaminda kullanici sahipligi JWT icindeki `userId` claim'i uzerinden event zincirine tasinir.

```text
JWT userId
-> /publish
-> documents.userId
-> document.uploaded.userId
-> document.processed.userId
-> exam.validation.completed.userId
-> exams.userId
```

Bu akista `userId`, API tarafinda protected endpoint middleware'i ile dogrulanmis kullanici context'inden alinir. API, `/publish` istegi sirasinda `documents` collection'ina kullanici sahipligi bulunan `uploaded` durumunda bir dokuman kaydi yazar. Worker ve validation servisleri bu bilgiyi event payload'i icinde korur. Exam service, gelen `userId` degerini MongoDB `ObjectId` formatinda dogrulayarak `exams.userId` alanina yazar.

## Persistence Read Flow

SCRUM-40 kapsaminda API service, JWT ile dogrulanmis kullanicinin kalici kayitlarini MongoDB uzerinden okur.

```text
GET /documents -> documents.find({ userId: JWT userId })
GET /exams     -> exams.find({ userId: JWT userId })
```

Bu endpointler sayesinde document ve exam kayitlari yalnizca event loglari ile degil, MongoDB collection'lari uzerinden create/read akisiyle de dogrulanabilir.

## Exam Content Generation Flow

SCRUM-90 kapsaminda exam-service, `validated` durumuna gecen examlar icin Anthropic Claude API'sini cagirip yapilandirilmis soru ve bilgi kartlari uretir.

```text
exam.validation.completed (valid)
-> exam-service documents.findOne({ documentId, userId })   # fileId/contentType/fileName
-> GridFS'ten binary indir (fileId)
-> Anthropic Messages API (tool use: submit_exam_content)
     PDF  -> document content block (base64) olarak gonderilir
     DOCX -> stdlib ile metne cevrilip prompt'a eklenir
     icerik yoksa -> metadata (dosya adi) fallback
-> JSON validation (4 secenek, A-D cevap, difficulty enum)
-> kalite degerlendirmesi (istenen sayi/zorluk + tamlik) -> qualityStatus + qualityIssues
-> exams.questions[] + exams.infoCards[] + exams.generationModel + exams.generationPrefs + exams.qualityStatus/qualityIssues
-> GET /exams (frontend exam detail viewer gercek veriyi + kalite sonucunu gosterir)
```

SCRUM-92 kapsaminda son kullanici upload sirasinda uretim tercihlerini (`questionCount`, `difficulty`, `infoCardCount`, `focus`) girer; api-service bunlari `documents.generationPrefs` alanina clamp/normalize ederek yazar. exam-service bu tercihleri okuyup prompt'a uygular ve uretilen icerigi tercihlere gore kalite kontrolunden gecirir: minimum soru sayisi, her soruda secenek/dogru cevap/aciklama, zorluk seviyesi ve konu etiketi. Sonuc `exams.qualityStatus` (`passed`/`failed`) ve `exams.qualityIssues` alanlarina yazilir; gecersiz ciktilar boylece sessizce kabul edilmek yerine kalite sonucuna yansir. Kalite kontrolu uretimi bloke etmez (exam yine kaydedilir), yalnizca sonucu gorunur kilar.

SCRUM-91 kapsaminda uretim, dokumanin **gercek icerigine** dayanir: exam-service GridFS'ten dosya binary'sini indirir, PDF'i Claude'a native document block olarak gonderir, DOCX'i standart kutuphane ile metne cevirir. Icerik alinamazsa metadata (dosya adi) fallback'ine duser. Gecici hatalarda (429/5xx, ag hatasi) ve hatali/eksik AI ciktilarinda kisa backoff ile **retry** yapilir (en fazla 3 deneme); kalici hatalarda (400/401/403) yeniden denenmez. Donen JSON ek olarak dogrulanir (tam 4 secenek, A-D cevap, gecerli difficulty); hicbir gecerli soru kalmazsa cikti hatali sayilir. `ANTHROPIC_API_KEY` tanimli degilse veya tum denemeler basarisiz olursa exam yine kaydedilir (soru alanlari bos kalir); bu sayede event zinciri hicbir zaman bloke olmaz. Model `ANTHROPIC_MODEL` ile yapilandirilir, varsayilan `claude-opus-4-8`.

SCRUM-88 ile document binary icerigi GridFS icinde saklanir ve asagidaki protected endpoint ile okunur:

```text
GET /documents/{documentId}/file -> documents.findOne({ userId: JWT userId, documentId }) -> GridFS fileId
```

Bu akista dosya endpoint'i `documents.userId` sahiplik kontrolu gecmeden GridFS stream acmaz.
