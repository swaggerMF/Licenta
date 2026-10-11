# TeD

**Your Type 1 bear analyst**

Calendar React care reconstruiește graficele zilnice din exportul CSV al senzorului. Fiecare zi are un grafic pe 24 de ore; selectarea ei deschide graficul detaliat, media, minimul și maximul. Poți naviga între luni și importa alte CSV-uri.

## Pornire locală

Necesită Node.js 20.19+, un compilator `g++` cu suport C++20 și un browser Chromium. Browserul trebuie să poată afișa ferestre pe calculatorul pe care rulează serverul.

```sh
cd frontend
npm install
npm run browser:install
npm run dev
```

`browser:install` poate fi omis dacă există Chromium în locațiile standard Linux. Pentru o altă locație a browserului, configurează `CARELINK_BROWSER_PATH`. `npm run dev` pornește atât serverul local CareLink pe `127.0.0.1:3001`, cât și React/Vite pe `http://127.0.0.1:5173`.

Înainte de pornire, scriptul compilează `main.cpp`, citește `in.csv` din rădăcina proiectului și generează `frontend/public/data.json`. Dacă nu există CSV local, poți importa unul direct din interfață. Pentru alt fișier local:

```sh
CSV_PATH="/cale/catre/export.csv" npm run dev
```

După modificarea CSV-ului local, repornește serverul pentru regenerarea datelor. Importul manual trimite CSV-ul la serverul local, unde este procesat de C++.

Exporturile se adaugă la istoricul existent, atât prin **Importă CSV**, cât și prin CareLink. Dacă ai septembrie–octombrie și imporți august, calendarul păstrează toate cele trei luni și afișează perioada nou importată. Suprapunerile sunt unite după dată, oră și evenimentul senzorului, fără măsurători duplicate; pentru aceeași măsurătoare este folosită ultima valoare validă importată. Un câmp gol nu șterge o glicemie deja disponibilă, iar motivele distincte pentru date lipsă sunt păstrate.

Istoricul importat rămâne în memoria serverului local la deconectarea/reconectarea CareLink și poate fi recuperat după reîncărcarea paginii. Nu este salvat permanent: după oprirea serverului, CSV-urile importate trebuie încărcate din nou. Datele inițiale din `data.json` se încarcă separat la pornirea paginii și sunt unite cu acest istoric.

## Conectare CareLink Personal

La deschidere apare o pagină cu **Login with CareLink** și opțiunea secundară **Import CSV**. Datele locale existente pot fi deschise cu **Continuă cu datele încărcate**; istoricul deja importat pe server se recuperează automat.

### Fluxul experimental cu browser automat

1. Apasă **Login with CareLink**. Butonul deschide direct fereastra CareLink, fără un dialog intermediar în aplicație. După login, se deschide selectorul de perioadă.
2. În fereastra oficială CareLink, alege țara contului și limba **English**, apoi continuă spre formularul de autentificare. Țara se selectează direct în CareLink.
3. Introdu utilizatorul și parola direct în fereastra oficială, apoi completează eventualul CAPTCHA sau cod de verificare. Interfața aplicației nu mai cere parola.
4. Lasă fereastra CareLink deschisă și revino în aplicație. După detectarea autentificării în Dashboard, aplicația deschide automat `/app/reports` pe domeniul sesiunii existente. După confirmarea loginului, fereastra CareLink este minimizată automat, iar aplicația solicită focalizarea propriei ferestre. Revenirea în prim-plan depinde de regulile browserului și ale desktopului. Dialogul afișează un calendar cu date în format **zz.ll.aaaa**, săptămâni începând luni, interval evidențiat și opțiuni rapide pentru ultimele 7/30 de zile încheiate sau luna curentă până ieri. Ziua de azi poate să nu fie disponibilă încă în CareLink. În prima zi a lunii, scurtătura pentru luna curentă este dezactivată. Login-ul nu pornește automat un export.
5. Alege perioada și apasă **Descarcă perioada**. Backendul revine în Reports dacă fereastra este în Dashboard, deschide calendarul, selectează anul, luna și zilele, apoi apasă Apply. Așteaptă confirmarea fiecărei selecții; ziua este identificată în luna aleasă fără interpretarea etichetelor de dată ca format american. Pornește exportul numai după confirmarea datelor și a perioadei afișate în Reports; dacă CareLink scurtează intervalul cerut, exportul este oprit. CSV-ul este procesat de C++ și adăugat istoricului existent.
6. Dacă selectorul CareLink nu poate fi identificat sau nu acceptă valorile, dialogul indică pasul nereușit, fără să declanșeze exportul. Activarea selectorului și încărcarea Reports au o limită de 12 secunde; celelalte operații de calendar au câte 5 secunde. Erorile disting încărcarea selectorului, apăsarea lui și afișarea calendarului. În fereastra minimizată, controalele sunt activate prin handlerul DOM, fără a aștepta stabilizarea animațiilor; controalele dezactivate nu sunt activate. Poți selecta perioada și apăsa **Data Export (CSV)** în aceeași fereastră CareLink; descărcarea este preluată automat.

Dacă ai ajuns la `https://carelink.minimed.eu/app/dashboard`, dar aplicația încă cere autentificarea, apasă **Verifică sesiunea**. Acest buton citește starea ferestrei existente, fără să retrimită credențialele. Detectarea recunoaște dashboard-ul încărcat, meniuri localizate și pagini Reports incluse în cadre CareLink; un formular de login vizibil sau o pagină goală nu confirmă sesiunea. Verificarea continuă și la actualizările automate ale stării, inclusiv după expirarea perioadei inițiale de așteptare.

**CareLink · Alege perioada** permite descărcarea altor intervale în aceeași sesiune. Sesiunea este reutilizată cât timp fereastra rămâne deschisă și CareLink o acceptă; nu este menținută prin încercări automate de autentificare.

Integrarea este un prototip local bazat pe automatizarea interfeței CareLink, nu pe un API oficial. Deschiderea paginii publice CareLink poate fi verificată fără credențiale; autentificarea este integral manuală. Selectorul de calendar a fost adaptat după componentele publice CareLink. Selectarea intervalului și descărcarea CSV au teste cu pagini simulate în Chromium care reproduc structura calendarului, inclusiv navigarea din Dashboard fără link Reports, formate de dată europene, selecții asincrone, intervale între luni, o singură zi, date indisponibile și perioade scurtate de furnizor. Un selector necunoscut nu declanșează exportul. Compatibilitatea cu selectorul de date disponibil în contul real necesită verificare după autentificare; CSV-urile pot fi importate și manual din aplicație.

În fluxul de test, parola se introduce direct în pagina oficială CareLink. Aplicația nu completează credențiale, nu trimite formularul de login și nu acceptă sau închide automat avertismente, consimțăminte ori mesaje. Dialogurile vizibile de confirmare împiedică preluarea automată a sesiunii până când sunt închise de utilizator. Sesiunea browserului și istoricul exporturilor importate sunt păstrate numai în memoria procesului. Fișierele temporare folosite pentru procesare sunt șterse după import. Nu sunt salvate capturi, urme de browser sau cookie-uri persistente.

Această versiune rulează pe calculatorul utilizatorului și ascultă doar pe loopback, cu cookie de sesiune HttpOnly și verificarea originii cererilor. Nu este un serviciu multiutilizator și nu trebuie expus ca backend public. Pe telefon se poate afișa ulterior interfața, dar automatizarea browserului și parserul C++ necesită această componentă locală sau o arhitectură de server separată.

## Parser și date

Parserul C++ păstrează comportamentul inițial. Opțiunea `--json` exportă în plus data, ora, glicemia și evenimentul senzorului:

```sh
g++ -std=c++20 -O2 main.cpp -o main
./main in.csv --json
```

Sunt folosite câmpurile `Date`, `Time`, `Sensor Glucose (mg/dL)` și `Sensor Exception` din secțiunea `Sensor`, la indicii 1, 2, 34 și 51. Atât descărcarea CareLink, cât și importul manual folosesc parserul C++ și separatorul `;`. Parserul JavaScript din `data.js` rămâne doar pentru comparația din teste. Orele și zilele sunt păstrate conform CSV-ului, fără conversii de fus orar. Măsurătorile sunt sortate cronologic pentru fiecare zi; pauzele de peste 15 minute întrerup linia graficului. Toate graficele folosesc aceeași scară verticală. Mediile sunt aritmetice, calculate din măsurătorile disponibile.

Rândurile fără glicemie sunt exportate cu `bg: null`, împreună cu motivul din `Sensor Exception`. Apar cu marcaje gri pe grafic și cu explicații în tooltip; dacă motivul lipsește din CSV, interfața precizează acest lucru. Valorile lipsă nu intră în statistici și întrerup linia graficului. Pentru intervalele fără niciun rând în CSV, tooltip-ul indică lipsa unei valori și a unui motiv specificat.

Linia graficului rămâne verde. Aria dintre curbă și pragul depășit este umplută cu galben aprins peste 180 mg/dL și roșu aprins sub 70 mg/dL, inclusiv în graficele mici din calendar. La hover, valoarea, ora și eventualul motiv apar într-un dreptunghi deasupra graficului, la începutul liniei punctate.

## Verificare și build

```sh
cd frontend
npm run build
npm test
npm run preview
```

Pentru conectare și import în modul preview, pornește și `npm run server` într-un alt terminal. Testele verifică API-ul local, importul real în C++, preluarea și curățarea descărcărilor, precum și gestionarea sesiunilor. Verificarea opțională `npm run check:carelink` accesează doar pagina publică, verifică deschiderea paginii oficiale de login, fără selectarea țării, apăsarea vreunui buton sau autentificare.

Build-ul include datele CSV locale în `dist/data.json`. Fișierele CSV și JSON-ul generat sunt ignorate de Git. O eventuală publicare a directorului `dist` include și măsurătorile exportate. Publicarea fișierelor statice nu include serverul local CareLink.
