---
title: Handleiding – Upload Portal voor Synology NAS (DSM 7)
description: Stap-voor-stap handleiding om Upload Portal op een Synology NAS te installeren, beveiligde uploadlinks per map te maken, maprechten in te stellen en links veilig via HTTPS te delen.
---

# Handleiding: Upload Portal voor Synology NAS

De interface van Upload Portal is Engelstalig; in deze handleiding staan de knopnamen daarom in het Engels.

In deze handleiding lees je hoe je **Upload Portal** installeert op een Synology NAS met **DSM 7**, hoe je **beveiligde uploadlinks** maakt die bestanden opslaan in een map die jij kiest, en hoe je die links veilig deelt via internet.

🇬🇧 English? Read the [User guide](USER-GUIDE.md).

**Inhoud**

1. [Wat heb je nodig](#1-wat-heb-je-nodig)
2. [Installeren](#2-installeren)
3. [Uploadgebruikers aanmaken](#3-uploadgebruikers-aanmaken)
4. [Maprechten](#4-maprechten)
5. [Uploadlinks maken en delen](#5-uploadlinks-maken-en-delen)
6. [Bereikbaar via internet (HTTPS)](#6-bereikbaar-via-internet-https)
7. [Wat ziet de uploader](#7-wat-ziet-de-uploader)
8. [Activiteit en logboek](#8-activiteit-en-logboek)
9. [Bijwerken, back-up en verwijderen](#9-bijwerken-back-up-en-verwijderen)
10. [Problemen oplossen](#10-problemen-oplossen)
11. [Beveiliging](#11-beveiliging)

---

## 1. Wat heb je nodig

- Een Synology NAS met **DSM 7.0 of nieuwer**
- **Node.js v20** uit Package Center. Ontbreekt het, dan wordt het automatisch geïnstalleerd.
- Een beheerdersaccount in DSM
- Optioneel, om links buiten je eigen netwerk te delen: een (sub)domein dat naar je NAS wijst, en poort 443 doorgestuurd naar de NAS

## 2. Installeren

1. Download de nieuwste **`UploadPortal-x.y.z.spk`** van de [Releases-pagina](https://github.com/ronaldjonkers/SynologyUpload/releases/latest).
   Wil je de download controleren? Gebruik dan het `.sha256`-bestand dat ernaast staat.
2. Open **Package Center → Instellingen → Algemeen**. Kies bij **Vertrouwensniveau** de optie **Elke uitgever** en klik op **OK**.
   *Upload Portal is niet door Synology ondertekend. DSM installeert zulke pakketten alleen met deze instelling.*
3. Klik op **Handmatige installatie**, kies het `.spk`-bestand en klik op **Volgende**.
4. Staat Node.js v20 nog niet op je NAS, dan vraagt Package Center of het geïnstalleerd mag worden. Bevestig dat.
5. Ga akkoord met de waarschuwing over pakketten van derden en rond de installatie af.
6. Open het **hoofdmenu** van DSM en start **Upload Portal**. Alleen leden van de groep `administrators` zien en openen de app.

Na de installatie draait de uploadserver op poort **8090**. Het beheer opent in een gewoon DSM-venster en gebruikt je DSM-login. Er is dus geen apart beheerwachtwoord.

## 3. Uploadgebruikers aanmaken

Uploadgebruikers zijn **geen** DSM-gebruikers. Ze kunnen alleen inloggen op uploadpagina's en hebben geen toegang tot DSM, File Station, SMB of iets anders op je NAS.

1. Ga naar het tabblad **Users** en klik op **New user**.
2. Vul een **gebruikersnaam** in, bijvoorbeeld `anna.jansen` of een e-mailadres.
3. Er wordt automatisch een **veilig wachtwoord** gemaakt:
   - standaard 24 tekens met hoofdletters, kleine letters, cijfers en symbolen
   - met de schuifregelaar **Length** kies je 12 tot 64 tekens, en met **Symbols** zet je symbolen aan of uit
   - tekens die je makkelijk verwart, zoals `0/O` en `1/l/I`, worden nooit gebruikt
   - de sterktemeter laat zien hoe sterk het wachtwoord is
4. Vink eventueel meteen de links aan die deze gebruiker mag gebruiken.
5. Klik op **Create user**.

Je ziet de inloggegevens nu **eenmalig**, elk met een kopieerknop. Daarnaast staat er een **kant-en-klare uitnodiging** klaar die je kunt kopiëren of mailen. Het wachtwoord is later niet meer in te zien. Ben je het kwijt, stel dan een nieuw wachtwoord in via het sleutelicoon 🔑 bij de gebruiker. Lopende sessies van die gebruiker worden dan direct uitgelogd.

![Gebruiker aanmaken met de wachtwoordgenerator](images/password-generator.png)

## 4. Maprechten

DSM 7 laat elk pakket van derden draaien als een eigen systeemgebruiker. Upload Portal kan daarom alleen bestanden opslaan in gedeelde mappen waar de systeemgebruiker **`UploadPortal`** **lees-/schrijfrechten** heeft.

In de mappenkiezer van een link zie je per gedeelde map:

- ✅ **Access**: uploaden is mogelijk
- 🔒 **No access**: de rechten ontbreken nog

**Optie A: vanuit de app.** Open de map en klik op **Grant access**. Upload Portal stelt de rechten dan via DSM in, met jouw beheerderssessie.

**Optie B: handmatig in DSM**

1. Open **Configuratiescherm → Gedeelde map**.
2. Selecteer de gedeelde map en klik op **Bewerken**.
3. Ga naar het tabblad **Machtigingen** en kies linksboven in de keuzelijst **Systeemgebruiker**.
4. Zoek **UploadPortal**, vink **Lezen/schrijven** aan en klik op **Opslaan**.

De rechten gelden voor de hele gedeelde map, inclusief alle submappen.

## 5. Uploadlinks maken en delen

1. Ga naar het tabblad **Links** en klik op **New link**.
2. **Name**: dit ziet de uploader, bijvoorbeeld "Foto's bruiloft Jansen".
3. **Destination folder**: klik door je NAS en kies de map. Bestanden komen **direct in deze map**; Upload Portal maakt nooit submappen aan. Ook als iemand een hele map sleept, komen alle bestanden in de gekozen map.
4. **Users with access**: vink aan wie mag uploaden. Je kunt hier ook direct een nieuwe gebruiker aanmaken.
5. Optionele instellingen:
   - **Expires on**: na deze datum werkt de link niet meer
   - **Max. file size** in MB
   - **Allowed file types**: extensies gescheiden door komma's, zoals `jpg, png, pdf`. Met de snelknoppen voeg je veelgebruikte groepen toe: foto's, video, documenten, audio en archieven. Laat je het veld leeg, dan is alles toegestaan. Andere types worden geweigerd, met een duidelijke melding welke types wel mogen.
   - **Link is active**: zet een link tijdelijk uit zonder hem te verwijderen
6. Klik op **Create link**. Het deelvenster opent met de URL en een uitnodigingstekst die je kunt kopiëren of mailen.

![Map kiezen voor een uploadlink](images/folder-picker.png)

**Links beheren.** Op elke linkkaart zie je de map, de gebruikers, de limieten en het aantal uploads. Je kunt:

- **Share**: de link of de uitnodiging opnieuw kopiëren
- ✏️ **Bewerken**: elke instelling aanpassen
- 🔄 **Nieuwe URL**: het oude adres werkt direct niet meer. Handig als een link bij de verkeerde persoon terecht is gekomen.
- 🗑️ **Verwijderen**: geüploade bestanden blijven op je NAS staan

> **Tip:** stuur het wachtwoord via een ander kanaal dan de link, bijvoorbeeld de link per e-mail en het wachtwoord per sms.

## 6. Bereikbaar via internet (HTTPS)

Binnen je netwerk zijn de uploadpagina's bereikbaar op `http://<nas-ip>:8090`. Wil je links delen met mensen buiten je netwerk, gebruik dan de ingebouwde **reverse proxy** van DSM met HTTPS:

1. Laat een (sub)domein, zoals `upload.jouwdomein.nl`, naar je publieke IP-adres wijzen. Synology DDNS kan ook.
2. Stuur op je router **TCP-poort 443** door naar je NAS.
3. Open in DSM **Configuratiescherm → Aanmeldingsportal → Geavanceerd → Reverse proxy → Maken**:

   | | Bron | Bestemming |
   |---|---|---|
   | Protocol | HTTPS | HTTP |
   | Hostnaam | `upload.jouwdomein.nl` | `localhost` |
   | Poort | 443 | 8090 |

4. Vraag een gratis certificaat aan via **Configuratiescherm → Beveiliging → Certificaat → Toevoegen → Let's Encrypt** voor `upload.jouwdomein.nl`, en koppel het via **Instellingen** aan de reverse-proxyregel.
5. Ga in Upload Portal naar **Settings** en vul `https://upload.jouwdomein.nl` in als publiek adres. Alle links gebruiken voortaan dit adres.

Stuur poort 8090 zelf **niet** door naar internet; laat de reverse proxy de HTTPS afhandelen.

## 7. Wat ziet de uploader

1. De uploader opent de link en logt in met gebruikersnaam en wachtwoord. Een waarschuwing bij Caps Lock en een knop om het wachtwoord te tonen helpen bij lange wachtwoorden.
2. Bestanden (of hele mappen) sleept hij of zij op de pagina, of kiest ze via **Choose files** of **Choose folder**. Als je toegestane types of een maximale grootte hebt ingesteld, staan die op de pagina.
3. Elk bestand krijgt een voortgangsbalk met de snelheid en de resterende tijd. De samenvatting toont de totale voortgang, de snelheid in MB/s, de resterende tijd en het aantal voltooide bestanden.
4. Bestanden die niet zijn toegestaan, worden **overgeslagen** met een melding. De andere bestanden worden gewoon geüpload.
5. Valt de verbinding weg, dan gaat de upload automatisch verder waar hij was. Wie het tabblad sluit tijdens een upload, krijgt eerst een waarschuwing.
6. Bestaat er al een bestand met dezelfde naam, dan wordt het nieuwe bestand opgeslagen als `naam (1).ext`. Er wordt nooit iets overschreven.

![Uploadpagina op een telefoon](images/upload-login-mobile.png)

## 8. Activiteit en logboek

- Het tabblad **Activity** toont elke upload met bestand, gebruiker, link, grootte en tijdstip, en je kunt erin zoeken.
- Bovenaan zie je de actieve links, de gebruikers, het totaal aantal uploads en de vrije schijfruimte.
- Het serverlog staat in `/var/packages/UploadPortal/var/server.log`. Package Center linkt er ook naar via **Upload Portal → Logboek bekijken**.

## 9. Bijwerken, back-up en verwijderen

- **Bijwerken:** download de nieuwe `.spk` en gebruik opnieuw **Handmatige installatie**. Je gegevens blijven behouden. Ververs DSM daarna in je browser met Ctrl/Cmd + Shift + R.
- **Back-up:** alle gebruikers, links en de geschiedenis staan in één bestand: `/var/packages/UploadPortal/var/db.json`. Maak er een kopie van via SSH, bijvoorbeeld `sudo cp /var/packages/UploadPortal/var/db.json /volume1/backup/`. Die map gaat dan mee in je gewone back-ups.
- **Verwijderen:** via Package Center. Geüploade bestanden blijven in je gedeelde mappen staan. De pakketgegevens (`db.json`) kunnen worden verwijderd, dus maak eerst een back-up als je je links wilt bewaren.

## 10. Problemen oplossen

| Probleem | Oplossing |
|---|---|
| Het pakket installeert niet | Zet het *vertrouwensniveau* op **Elke uitgever** en controleer of Node.js v20 beschikbaar is in Package Center. |
| "Upload Portal is not running" in het beheer | Start het pakket in Package Center en bekijk `server.log`. |
| "Your DSM session has expired" | Ververs de DSM-pagina en open de app opnieuw. |
| Een map toont **No access** | Zie [Maprechten](#4-maprechten). |
| Op een linkkaart staat "Folder not found" | De map is hernoemd of verwijderd. Bewerk de link en kies opnieuw een map. |
| Links werken alleen binnen je eigen netwerk | Stel de [reverse proxy](#6-bereikbaar-via-internet-https) in en vul het publieke adres in bij *Settings*. |
| Uploaders krijgen "File type not allowed" | Voeg de extensie toe bij *Allowed file types* van die link, of laat het veld leeg. |
| Te veel inlogpogingen | Na 8 mislukte pogingen wordt het IP-adres 15 minuten geblokkeerd. |

Kom je er niet uit? [Maak een issue aan](https://github.com/ronaldjonkers/SynologyUpload/issues) en vermeld je DSM-versie en de relevante regels uit `server.log`.

## 11. Beveiliging

- Uploadgebruikers hebben **geen toegang** tot DSM of je bestanden; ze kunnen alleen uploaden.
- Wachtwoorden worden opgeslagen als **scrypt**-hash. Sessies gebruiken ondertekende HttpOnly-cookies.
- Na 8 mislukte inlogpogingen wordt een IP-adres 15 minuten geblokkeerd.
- Bestandsnamen en paden worden opgeschoond, zodat er nooit iets buiten de gekozen map terechtkomt.
- Bestaande bestanden worden nooit overschreven, en uploaders kunnen geen bestanden zien of downloaden.
- De beheer-API is alleen bereikbaar via DSM: er is een geldige DSM-sessie van een beheerder nodig, waarna de CGI-brug het verzoek via localhost doorstuurt met een geheime sleutel.
- Gebruik HTTPS (onderdeel 6) als je links via internet deelt.

Een kwetsbaarheid gevonden? Volg dan [SECURITY.md](../SECURITY.md).
