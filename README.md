# Viaggi a scuola

Planner statico per colleghi che condividono un unico punto di ritrovo e una sede di lavoro. Non richiede server applicativi, database o dipendenze JavaScript.

## Utilizzo

1. In **Colleghi e auto**, aggiungere i colleghi e indicare chi mette a disposizione un'auto. Impostare durata della tratta e posti, conducente incluso.
2. In **Orario tipo**, salvare le presenze abituali dal lunedì alla domenica, oppure usare **Importa orari** con un backup JSON.
3. Scegliere una settimana e premere **Precompila dall'orario tipo**. Le modifiche alla settimana non cambiano il modello né le altre settimane.
4. Ogni fascia comprende un ingresso e un'uscita dalla sede. Per un rientro intermedio aggiungere una seconda fascia allo stesso collega e giorno. Un'ora buca trascorsa in sede resta nella stessa fascia.
5. Premere **Calcola la settimana**. I giorni senza abbastanza auto o con fasce da verificare vengono segnalati e non producono assegnazioni parziali spacciate per complete.

La sede **Falcade** (sigla F nell'orario) indica uno spostamento autonomo. Per impostazione, chi ha un impegno a Falcade non offre né richiede passaggi sulla tratta comune per quel giorno, anche se ha altre fasce nella sede comune. Il programma lo mostra esplicitamente tra gli autonomi; la disponibilità auto degli altri giorni resta invariata. Gli spostamenti autonomi non rientrano nel conteggio dei viaggi condivisi e non usano la durata della tratta comune. La sede si può modificare nell'orario tipo o nella singola settimana.

La sigla **D** indica la disponibilità a restare fino a un'ora oltre l'uscita prevista. Si attiva sulla singola fascia, nell'orario tipo o nella settimana. Il calcolo può usarla per rendere possibile un piano o ridurre le auto necessarie; a parità di auto preferisce meno minuti aggiuntivi. L'orario previsto resta invariato e il piano mostra esplicitamente chi rimane, fino a quando e per quanti minuti. Non si anticipano le uscite e non si prolungano le fasce di chi non ha dato disponibilità. Per esempio, un'uscita prevista alle 10:45 con D può diventare un ritorno alle 11:45 per condividere l'auto con un collega che termina allora.

Gli orari sono salvati nel `localStorage` del browser e del dominio corrente. Non c'è sincronizzazione fra dispositivi, colleghi o URL Vercel differenti. Usare **Esporta backup** per trasferirli o conservarne una copia. L'importazione e il ripristino di una settimana richiedono conferma; le ultime 20 modifiche si possono annullare fino alla chiusura/ricarica della pagina. Le settimane già preparate, anche se vuote, non vengono sovrascritte automaticamente.

L'importazione supporta sia il formato versione 2 sia i vecchi file `{ people, days }`: i giorni con data diventano settimane concrete, quelli con il solo nome del giorno diventano un orario tipo. Nel formato con soli nomi delle persone la disponibilità auto è da impostare.

## Calcolo

- Gli ingressi e le uscite previste sono esatti, salvo il margine di massimo 60 minuti espressamente autorizzato con D per il ritorno.
- Le auto hanno capienza comune; il conducente occupa un posto.
- Una persona scelta come conducente per una fascia guida la propria auto sia all'andata sia al ritorno di quella fascia. Può essere passeggera in una fascia successiva. Non sono previsti prestiti di auto, soste intermedie, viaggi a vuoto o pernottamenti.
- I passeggeri possono cambiare auto al ritorno.
- Fra due fasce dello stesso collega devono esserci almeno due volte i minuti della tratta, per tornare al ritrovo e risalire. Il prolungamento D viene limitato per rispettare questo intervallo e concludere il viaggio nella stessa giornata.
- Per ogni combinazione di uscite, il minimo numero di viaggi in auto viene calcolato con una circolazione a costo minimo: ogni fascia di un potenziale conducente collega il suo gruppo di andata a quello di ritorno. I limiti inferiori garantiscono i posti necessari in entrambi i versi. Si confrontano le uscite possibili con D, scegliendo prima meno auto, poi meno minuti aggiuntivi e infine un minore carico di guida precedente nella settimana. Non è una garanzia di ripartizione perfettamente uniforme.
- Per mantenere reattivo il browser con importazioni molto grandi, la ricerca si ferma dopo 5.000 combinazioni. Se accade, il piano segnala che potrebbe esistere una soluzione migliore; se non ha trovato un piano completo, chiede di precisare alcune uscite. Non presenta un risultato parziale come completo né un minimo non verificato.

Gli orari personali importati non fanno parte del codice distribuito. Il file di esempio nel repository è nel vecchio formato ed è ancora importabile. Le note di importazione e le fasce `needsReview` conservano le incertezze della fonte; queste ultime bloccano il piano del giorno finché verificate.

## Sviluppo e verifiche

Servire questa cartella con un server HTTP statico (ad esempio `python3 -m http.server 4173`), quindi aprire `http://localhost:4173`. Non aprire `index.html` direttamente come `file://`, perché usa moduli JavaScript.

Con Node.js 22 o successivo:

```sh
npm test
```

I test coprono fasce multiple, capienza, conducente su entrambi i versi, assenza di auto, sovrapposizioni, tempi di viaggio, disponibilità D, Falcade, copie indipendenti delle settimane, importazione dei vecchi backup, date e passaggio all'ora legale. L'ottimizzatore viene anche confrontato con una ricerca esaustiva in 300 piccoli scenari a orari fissi e 100 con uscite flessibili. Nei backup precedenti, l'assenza di `canStayExtraHour` equivale a nessuna disponibilità aggiuntiva; il formato rimane versione 2.

Per Vercel usare il preset **Other**, servendo la cartella del repository: non è necessaria una build. Mantenere l'URL abituale per conservare l'accesso ai dati salvati in quel browser. La versione precedente non aveva persistenza locale: eventuali dati possono essere recuperati dai suoi file JSON esportati.
