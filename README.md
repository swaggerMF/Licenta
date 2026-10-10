# Calendar glicemic

Calendar React care reconstruiește graficele zilnice din exportul CSV al senzorului. Fiecare zi are un grafic pe 24 de ore; selectarea ei deschide graficul detaliat, media, minimul și maximul. Poți naviga între luni și importa alte CSV-uri.

## Pornire locală

Necesită Node.js 20.19+ și un compilator `g++` cu suport C++20.

```sh
cd frontend
npm install
npm run dev
```

Deschide adresa afișată de Vite (implicit `http://127.0.0.1:5173`). Înainte de pornire, scriptul compilează `main.cpp`, citește `in.csv` din rădăcina proiectului și generează `frontend/public/data.json`. Dacă nu există CSV local, poți importa unul direct din interfață. Pentru alt fișier local:

```sh
CSV_PATH="/cale/catre/export.csv" npm run dev
```

După modificarea CSV-ului local, repornește serverul pentru regenerarea datelor. Datele importate prin interfață sunt procesate în browser și se păstrează doar până la reîncărcarea paginii.

## Parser și date

Parserul C++ păstrează comportamentul inițial. Opțiunea `--json` exportă în plus data, ora, glicemia și evenimentul senzorului:

```sh
g++ -std=c++20 -O2 main.cpp -o main
./main in.csv --json
```

Sunt folosite câmpurile `Date`, `Time`, `Sensor Glucose (mg/dL)` și `Sensor Exception` din secțiunea `Sensor`, la indicii 1, 2, 34 și 51. Importul din browser folosește același format cu separator `;`. Orele și zilele sunt păstrate conform CSV-ului, fără conversii de fus orar. Măsurătorile sunt sortate cronologic pentru fiecare zi; pauzele de peste 15 minute întrerup linia graficului. Toate graficele folosesc aceeași scară verticală. Mediile sunt aritmetice, calculate din măsurătorile disponibile.

Rândurile fără glicemie sunt exportate cu `bg: null`, împreună cu motivul din `Sensor Exception`. Apar cu marcaje gri pe grafic și cu explicații în tooltip; dacă motivul lipsește din CSV, interfața precizează acest lucru. Valorile lipsă nu intră în statistici și întrerup linia graficului. Pentru intervalele fără niciun rând în CSV, tooltip-ul indică lipsa unei valori și a unui motiv specificat.

Linia graficului rămâne verde. Aria dintre curbă și pragul depășit este umplută cu galben aprins peste 180 mg/dL și roșu aprins sub 70 mg/dL, inclusiv în graficele mici din calendar. La hover, valoarea, ora și eventualul motiv apar într-un dreptunghi deasupra graficului, la începutul liniei punctate.

## Verificare și build

```sh
cd frontend
npm run build
npm test
npm run preview
```

Build-ul include datele CSV locale în `dist/data.json`. Fișierele CSV și JSON-ul generat sunt ignorate de Git. O eventuală publicare a directorului `dist` include și măsurătorile exportate.
