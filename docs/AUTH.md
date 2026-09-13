# Auth-skiss — inloggning för lärare

Utkast. Implementeras fullt ut i Läge 5-objektet (säkerhetsregler);
detta dokument definierar strukturen reglerna bygger på.

## Modell

- **Firebase Authentication** med **e-post + lösenord** (enkelt för en
  liten lärargrupp; Google-inloggning kan läggas till senare utan
  strukturändring).
- Ingen självregistrering: konton skapas i Firebase-konsolen av den
  som administrerar projektet. Vid första inloggning skapas/uppdateras
  lärarprofilen `teachers/{uid}` (se DATAMODELL.md) med `email`,
  `displayName` och `classIds`.
- **Elevskärmen kräver ingen inloggning i sig** — den är ett fönster
  öppnat från lärarens inloggade session och läser via samma klient.

## Flöde i appen

1. Utan Firebase-konfiguration (lokalt läge): ingen inloggning —
   appen är fullt användbar lokalt. Auth-lagret är en no-op.
2. Med Firebase: `onAuthStateChanged` vid start. Ej inloggad →
   enkel inloggningsvy (e-post/lösenord) i stället för appskalet;
   inloggad → `uid` läggs i store och appen startar som vanligt.
3. Datalagret fortsätter vara offline-first: Firestores egna
   auth-tokens cachas av SDK:n, så en redan inloggad lärare kan
   starta appen offline.

## Säkerhetsregler (princip, byggs i Läge 5)

```
match /teachers/{uid} {
  allow read, write: if request.auth.uid == uid;
}
match /classes/{classId}/{document=**} {
  // Inloggad lärare vars profil listar klassen
  allow read, write: if request.auth != null
    && classId in get(/databases/$(database)/documents/teachers/$(request.auth.uid)).data.classIds;
}
```

Alternativ om alla lärare ska se alla klasser (litet arbetslag):
släpp `classIds`-kravet och kräv endast `request.auth != null`.
Modellen ovan är förberedd för båda.
