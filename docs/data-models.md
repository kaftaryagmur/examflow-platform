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
| `fileName` | string | Yuklenen dosya adi |
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
| `userId` | ObjectId | Sinav sahibi kullanici, auth/ownership sonrasi zorunlu olacak |
| `documentId` | string | Sinavin uretildigi document referansi |
| `title` | string | Opsiyonel sinav basligi |
| `validationResult` | string | `valid`, `invalid`, `passed`, `failed` |
| `status` | string | `draft`, `processing`, `validated`, `published`, `failed` |
| `createdAt` | string | UTC RFC3339 olusturma zamani |
| `updatedAt` | string | UTC RFC3339 guncelleme zamani |

## Relations

```text
User 1 -> N Document
User 1 -> N Exam
Document 1 -> N Exam
```

MongoDB dokuman modeli kullanildigi icin iliskiler foreign key constraint ile degil, `ObjectId` referanslari ve uygulama seviyesindeki kontrol ile yonetilir. SCRUM-32 kapsaminda bu referanslar ownership kurallariyla guclendirilecektir.

## Ownership Flow

SCRUM-32 kapsaminda kullanici sahipligi JWT icindeki `userId` claim'i uzerinden event zincirine tasinir.

```text
JWT userId
-> /publish
-> document.uploaded.userId
-> document.processed.userId
-> exam.validation.completed.userId
-> exams.userId
```

Bu akista `userId`, API tarafinda protected endpoint middleware'i ile dogrulanmis kullanici context'inden alinir. Worker ve validation servisleri bu bilgiyi event payload'i icinde korur. Exam service, gelen `userId` degerini MongoDB `ObjectId` formatinda dogrulayarak `exams.userId` alanina yazar.
