# Calendar glicemic

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

După modificarea CSV-ului local, repornește serverul pentru regenerarea datelor. Importul manual trimite CSV-ul la serverul local, unde este procesat de C++; datele importate manual se păstrează în interfață până la reîncărcarea paginii.

## Conectare CareLink Personal

### Dacă CAPTCHA respinge autentificarea în fereastra automată

Folosește **Deschide în browserul tău** din dialogul CareLink. Linkul deschide pagina oficială într-un tab al browserului în care folosești aplicația, fără automatizare Playwright. Selectează țara și autentifică-te acolo, apoi deschide Reports și descarcă **Data Export (CSV)**. În acest mod autentificarea și apăsarea exportului sunt manuale; preluarea CSV-ului și actualizarea calendarului sunt automate.

Activarea acestui mod închide sesiunea automată și urmărește CSV-urile noi sau modificate în `~/Downloads` (sau `~/Descărcări`, dacă acesta există în locul Downloads). Fișierele deja existente la activare sunt ignorate. Exporturile trebuie să ajungă în folderul afișat în dialog; dacă browserul descarcă în altă parte, pornește aplicația astfel:

```sh
CARELINK_DOWNLOAD_DIR="/cale/catre/descarcari" npm run dev
```

Un fișier este procesat doar după ce dimensiunea și data modificării rămân stabile între două verificări. Fișierele parțiale `.crdownload` și CSV-urile care nu conțin secțiunea Sensor sunt ignorate. Originalele din Downloads nu sunt mutate sau șterse. **Oprește preluarea** oprește monitorizarea folderului; nu deconectează contul din browserul obișnuit. Pentru fișiere descărcate înainte de activare sau salvate în alt folder rămâne disponibil **Importă CSV**.

O CAPTCHA respinsă în browserul automat nu demonstrează că imaginile au fost selectate greșit. Dacă autentificarea funcționează în browserul obișnuit, mediul sesiunii automate este o cauză posibilă; acest mod evită automatizarea autentificării, fără să modifice sau să încerce să rezolve CAPTCHA.

### Fluxul experimental cu browser automat

1. Apasă **Conectează CareLink** și selectează țara contului.
2. Introdu utilizatorul/emailul și parola, sau lasă ambele câmpuri goale pentru a le completa direct pe pagina oficială.
3. Apasă **Continuă în CareLink**. Aplicația deschide un browser separat, selectează țara și deschide formularul oficial. Pentru România a fost verificată redirecționarea către `carelink-login.minimed.eu`.
4. Completează în fereastra CareLink orice pas suplimentar de autentificare, inclusiv codul de verificare dacă este cerut.
5. După detectarea secțiunii Reports/Rapoarte, aplicația încearcă automat exportul CSV. Este folosită perioada selectată în CareLink; aplicația nu impune momentan un interval propriu.
6. Dacă butonul nu poate fi detectat sau cere selectarea perioadei, deschide Reports în aceeași fereastră, alege perioada și apasă **Data Export (CSV)**. Descărcarea este interceptată automat, procesată de C++, iar calendarul este actualizat.

**Sincronizează** repetă exportul în sesiunea curentă. **Deconectează** închide browserul și șterge sesiunea din memoria serverului. Datele deja afișate în calendar rămân până la importul următor sau reîncărcare.

Integrarea este un prototip local bazat pe automatizarea interfeței CareLink, nu pe un API oficial. Selecția țării și deschiderea formularului de autentificare au fost verificate pe site-ul real, fără credențiale. Detectarea Reports și declanșarea exportului după login necesită încă verificare cu un cont real; există preluarea descărcării manuale ca alternativă.

Parola nu este scrisă în fișiere sau loguri; dacă este introdusă în aplicație, este folosită temporar pentru completarea formularului oficial. Sesiunea browserului și ultimul export CareLink sunt păstrate numai în memoria procesului. Fișierele temporare folosite pentru procesare sunt șterse după import. Nu sunt salvate capturi, urme de browser sau cookie-uri persistente.

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

Pentru conectare și import în modul preview, pornește și `npm run server` într-un alt terminal. Testele verifică API-ul local, importul real în C++, preluarea și curățarea descărcărilor, precum și gestionarea sesiunilor. Verificarea opțională `npm run check:carelink` accesează doar pagina publică, selectează România și verifică formularul oficial, fără autentificare.

Build-ul include datele CSV locale în `dist/data.json`. Fișierele CSV și JSON-ul generat sunt ignorate de Git. O eventuală publicare a directorului `dist` include și măsurătorile exportate. Publicarea fișierelor statice nu include serverul local CareLink.
