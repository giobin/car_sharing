# Viaggi a scuola

Planner statico per colleghi che condividono un unico punto di ritrovo e una sede di lavoro. Non richiede server applicativi, database o dipendenze JavaScript.

## Utilizzo

1. In **Colleghi e auto**, aggiungere i colleghi e indicare chi mette a disposizione un'auto. Impostare durata della tratta e posti, conducente incluso.
2. In **Orario tipo**, salvare le presenze abituali dal lunedì alla domenica, oppure usare **Importa orari** con un backup JSON.
3. Scegliere una settimana e premere **Precompila dall'orario tipo**. Le modifiche alla settimana non cambiano il modello né le altre settimane.
4. Ogni fascia comprende un ingresso e un'uscita dalla sede. Per un rientro intermedio aggiungere una seconda fascia allo stesso collega e giorno. Un'ora buca trascorsa in sede resta nella stessa fascia.
5. Premere **Calcola la settimana**. I giorni senza abbastanza auto o con fasce da verificare vengono segnalati e non producono assegnazioni parziali spacciate per complete.

Gli orari sono salvati nel `localStorage` del browser e del dominio corrente. Non c'è sincronizzazione fra dispositivi, colleghi o URL Vercel differenti. Usare **Esporta backup** per trasferirli o conservarne una copia. L'importazione e il ripristino di una settimana richiedono conferma; le ultime 20 modifiche si possono annullare fino alla chiusura/ricarica della pagina. Le settimane già preparate, anche se vuote, non vengono sovrascritte automaticamente.

L'importazione supporta sia il formato versione 2 sia i vecchi file `{ people, days }`: i giorni con data diventano settimane concrete, quelli con il solo nome del giorno diventano un orario tipo. Nel formato con soli nomi delle persone la disponibilità auto è da impostare.

## Calcolo

- Gli orari sono esatti: nessun anticipo o attesa viene introdotto automaticamente.
- Le auto hanno capienza comune; il conducente occupa un posto.
- Una persona scelta come conducente per una fascia guida la propria auto sia all'andata sia al ritorno di quella fascia. Può essere passeggera in una fascia successiva. Non sono previsti prestiti di auto, soste intermedie, viaggi a vuoto o pernottamenti.
- I passeggeri possono cambiare auto al ritorno.
- Fra due fasce dello stesso collega devono esserci almeno due volte i minuti della tratta, per tornare al ritrovo e risalire.
- Il minimo numero di viaggi in auto viene calcolato con una circolazione a costo minimo: ogni fascia di un potenziale conducente collega il suo gruppo di andata a quello di ritorno. I limiti inferiori garantiscono i posti necessari in entrambi i versi. Fra soluzioni con lo stesso numero di viaggi si favorisce chi ha guidato meno nei giorni precedenti della settimana; non è una garanzia di ripartizione perfettamente uniforme.

Gli orari personali importati non fanno parte del codice distribuito. Il file di esempio nel repository è nel vecchio formato ed è ancora importabile. Le note di importazione e le fasce `needsReview` conservano le incertezze della fonte; queste ultime bloccano il piano del giorno finché verificate.

## Sviluppo e verifiche

Servire questa cartella con un server HTTP statico (ad esempio `python3 -m http.server 4173`), quindi aprire `http://localhost:4173`. Non aprire `index.html` direttamente come `file://`, perché usa moduli JavaScript.

Con Node.js 22 o successivo:

```sh
npm test
```

I test coprono fasce multiple, capienza, conducente su entrambi i versi, assenza di auto, sovrapposizioni, tempi di viaggio, copie indipendenti delle settimane, importazione dei vecchi backup, date e passaggio all'ora legale. L'ottimizzatore viene anche confrontato con una ricerca esaustiva in 300 piccoli scenari deterministici.

Per Vercel usare il preset **Other**, servendo la cartella del repository: non è necessaria una build. Mantenere l'URL abituale per conservare l'accesso ai dati salvati in quel browser. La versione precedente non aveva persistenza locale: eventuali dati possono essere recuperati dai suoi file JSON esportati.
