# ExamFlow Data Models

SCRUM-27 kapsaminda temel domain modelleri MongoDB collection yapisina gore tanimlanir.

## Collections

```text
users
documents
exams
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
| `createdAt` | string | UTC RFC3339 olusturma zamani |
| `updatedAt` | string | UTC RFC3339 guncelleme zamani |

`questions[]` elemanlari su alt alanlari tasir: `question` (metin), `options` (4 secenek), `correctAnswer` (A/B/C/D), `explanation`, `difficulty` (`easy`/`medium`/`hard`), `topic`. `infoCards[]` elemanlari ise `title`, `summary` ve `keyPoints` (string listesi) tasir.

## Relations

```text
User 1 -> N Document
User 1 -> N Exam
Document 1 -> N Exam
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
-> exam-service documents.findOne({ documentId, userId })   # fileName/source bağlamı
-> Anthropic Messages API (tool use: submit_exam_content)
-> exams.questions[] + exams.infoCards[] + exams.generationModel
-> GET /exams (frontend exam detail viewer gercek veriyi gosterir)
```

Pipeline dokuman metnini tasimadigi icin uretim, dokuman metadata bilgisine (dosya adi/kaynak) dayanir. `ANTHROPIC_API_KEY` tanimli degilse veya uretim hata verirse exam yine kaydedilir (soru alanlari bos kalir); bu sayede event zinciri hicbir zaman bloke olmaz. Model `ANTHROPIC_MODEL` ile yapilandirilir, varsayilan `claude-opus-4-8`.

SCRUM-88 ile document binary icerigi GridFS icinde saklanir ve asagidaki protected endpoint ile okunur:

```text
GET /documents/{documentId}/file -> documents.findOne({ userId: JWT userId, documentId }) -> GridFS fileId
```

Bu akista dosya endpoint'i `documents.userId` sahiplik kontrolu gecmeden GridFS stream acmaz.
