<p align="center">
  <img src="docs/images/icon.png" width="96" height="96" alt="Upload Portal voor Synology icoon">
</p>

<h1 align="center">Upload Portal voor Synology NAS</h1>

<p align="center">
  <b>Beveiligde uploadlinks met wachtwoord voor Synology DSM 7.</b><br>
  Laat klanten, familie en collega's bestanden direct in een map op je NAS uploaden: met drag & drop, ook voor grote bestanden, en met live voortgang en snelheid.
</p>

<p align="center">
  <a href="https://github.com/ronaldjonkers/SynologyUpload/releases/latest"><img alt="Nieuwste release" src="https://img.shields.io/github/v/release/ronaldjonkers/SynologyUpload?label=download%20.spk&color=6366f1"></a>
  <img alt="DSM 7" src="https://img.shields.io/badge/Synology-DSM%207.x-0d6efd">
  <a href="LICENSE"><img alt="MIT-licentie" src="https://img.shields.io/badge/licentie-MIT-blue"></a>
</p>

<p align="center">
  <a href="#installeren">Installeren</a> ·
  <a href="docs/HANDLEIDING.md">Handleiding</a> ·
  <a href="#veelgestelde-vragen">Veelgestelde vragen</a> ·
  <a href="README.md">🇬🇧 English</a>
</p>

---

**Upload Portal** is een gratis, open-source **Synology-pakket (.spk)** waarmee je via je eigen NAS bestanden van anderen ontvangt. Het is een privé-alternatief voor WeTransfer, Dropbox File Requests of uploadformulieren van Google Drive. Je maakt **uploadlinks**, kiest per link **in welke map op je NAS** de bestanden komen, en bepaalt met een gebruikersnaam en wachtwoord **wie** mag uploaden. De ontvanger opent de link in een willekeurige browser, logt in en sleept de bestanden erin. Er is geen DSM-account nodig, geen toegang tot File Station en geen externe cloud.

![Uploadpagina met drag & drop, voortgangsbalk en snelheid](docs/images/upload-progress.png)

## Functies

- 📦 **Echt Synology-pakket**: installeer via *Package Center → Handmatige installatie*. Het draait op DSM 7 met Node.js; Docker is niet nodig.
- 🔗 **Uploadlinks per map**: elke link slaat bestanden direct op in de map die jij kiest, op elk volume.
- 👤 **Aparte uploadaccounts**: gebruikers die alleen kunnen uploaden, los van je DSM-gebruikers.
- 🔐 **Wachtwoordgenerator**: standaard 24 tekens (instelbaar van 12 tot 64), met sterktemeter en kopieerknop.
- ✉️ **Kant-en-klare uitnodiging** met de link en de inloggegevens, om te kopiëren of te mailen.
- 🖱️ **Drag & drop** van bestanden en hele mappen, en het werkt ook op mobiel.
- 📊 **Live voortgang, uploadsnelheid (MB/s) en resterende tijd**, per bestand en in totaal.
- 🚀 **Grote bestanden (vele GB's)**: uploads in blokken, die bij een verbroken verbinding automatisch verdergaan.
- 🧾 Per link in te stellen: **toegestane bestandstypen** (bijv. `jpg, png, pdf`), een **maximale bestandsgrootte** en een **vervaldatum**.
- 🛡️ **Veilig**: er wordt nooit iets overschreven, wachtwoorden worden met scrypt opgeslagen, er is een blokkade na te veel inlogpogingen, en uploads blijven altijd binnen de gekozen map.
- 🌍 **Engelstalige interface**, zodat ook ontvangers in het buitenland ermee uit de voeten kunnen.
- 🧭 **Beheer in DSM**: met je DSM-login (alleen voor beheerders), met zoekfunctie, activiteitenlog en een overzicht van de vrije ruimte.

<table>
  <tr>
    <td><img src="docs/images/admin-links.png" alt="Upload Portal beheer in Synology DSM met uploadlinks"></td>
    <td><img src="docs/images/folder-picker.png" alt="Doelmap op de Synology NAS kiezen voor een uploadlink"></td>
  </tr>
</table>

## Installeren

1. **Download** de nieuwste `UploadPortal-x.y.z.spk` van de [**Releases-pagina**](https://github.com/ronaldjonkers/SynologyUpload/releases/latest).
2. Ga in DSM naar **Package Center → Instellingen → Algemeen → Vertrouwensniveau** en kies **Elke uitgever**.
3. Ga naar **Package Center → Handmatige installatie**, kies het `.spk`-bestand en volg de stappen. Node.js v20 wordt indien nodig automatisch geïnstalleerd.
4. Open **Upload Portal** in het hoofdmenu van DSM.

Bijwerken gaat op dezelfde manier. Gebruikers, links en de geschiedenis blijven behouden.

👉 Alle stappen, inclusief HTTPS en maprechten, staan in de **[handleiding](docs/HANDLEIDING.md)**.

## Snel aan de slag

1. **Users → New user**: er wordt direct een sterk wachtwoord gemaakt.
2. **Links → New link**: geef de link een naam, kies de map, vink de gebruikers aan en stel eventueel bestandstypen, een maximale grootte of een vervaldatum in.
3. Staat er bij een map **No access**? Klik dan op **Grant access**, of geef de systeemgebruiker `UploadPortal` lees-/schrijfrechten via *Configuratiescherm → Gedeelde map*.
4. Klik op **Share** en verstuur de uitnodiging.

Wil je links via internet delen, stel dan de **reverse proxy** van DSM in met een Let's Encrypt-certificaat. Zie de [handleiding](docs/HANDLEIDING.md#6-bereikbaar-via-internet-https).

## Veelgestelde vragen

<details>
<summary><b>Hoe laat ik klanten bestanden uploaden naar mijn Synology zonder ze een DSM-account te geven?</b></summary>

Maak in Upload Portal een uploadgebruiker en een uploadlink voor de juiste map, en stuur de link. Uploadgebruikers bestaan alleen binnen Upload Portal. Ze kunnen niet inloggen op DSM, File Station of SMB, en zien alleen de uploadpagina.
</details>

<details>
<summary><b>Wat is het verschil met de bestandsaanvraag in File Station?</b></summary>

Een bestandsaanvraag in File Station is één gedeelde link, eventueel met één wachtwoord. Upload Portal geeft iedereen een eigen login. Je kunt per link bestandstypen en de bestandsgrootte beperken, je ziet wie wat heeft geüpload, grote bestanden gaan in blokken en kunnen verdergaan na een onderbreking, en de uploader ziet live de snelheid en de resterende tijd.
</details>

<details>
<summary><b>Kunnen uploaders bestanden zien die al in de map staan?</b></summary>

Nee. Upload Portal accepteert alleen uploads en toont of levert nooit bestaande bestanden.
</details>

<details>
<summary><b>Heb ik Docker of Container Manager nodig?</b></summary>

Nee. Het is een echt DSM-pakket dat draait op het Node.js v20-pakket van Synology.
</details>

## Licentie

[MIT](LICENSE) © Ronald Jonkers. Niet verbonden aan Synology Inc. *Synology* en *DSM* zijn handelsmerken van Synology Inc.

<sub>Trefwoorden: Synology uploadlink, bestanden ontvangen op Synology NAS, uploadportaal voor klanten, Synology bestandsaanvraag, DSM 7 pakket, SPK, WeTransfer-alternatief, uploadpagina met wachtwoord, grote bestanden uploaden naar NAS.</sub>
