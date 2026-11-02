"""Build an offline SQLite minute index once, without loading the archive into RAM."""
import json,sqlite3,sys
from datetime import datetime,timezone
from pathlib import Path
import databento as db
ROOT=Path(__file__).resolve().parents[1]/'data/private'
def build(source,target):
 target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_suffix('.building.db')
 con=sqlite3.connect(temp);con.execute('CREATE TABLE IF NOT EXISTS bars(time INTEGER,symbol TEXT,day TEXT,open REAL,high REAL,low REAL,close REAL,volume INTEGER)')
 con.execute('CREATE UNIQUE INDEX IF NOT EXISTS minute_symbol ON bars(symbol,time)');con.commit()
 count=con.execute('SELECT COUNT(*) FROM bars').fetchone()[0];resume=con.execute('SELECT MAX(time) FROM bars').fetchone()[0] or 0
 for chunk in db.DBNStore.from_file(source).to_df(count=100000):
  if int(chunk.index.max().value//1000000)<resume:continue
  chunk=chunk[chunk.index.as_unit('ms').asi8>=resume]
  f=chunk[chunk.symbol.str.fullmatch(r'(NQ|ES)[HMUZ]\d{1,2}',na=False)]
  if f.empty:continue
  stamps=f.index.as_unit('ms').asi8;day_ids=(stamps//86400000).tolist();labels={d:datetime.fromtimestamp(d*86400,timezone.utc).date().isoformat() for d in set(day_ids)}
  rows=zip(stamps.tolist(),f.symbol.tolist(),[labels[d] for d in day_ids],f.open.tolist(),f.high.tolist(),f.low.tolist(),f.close.tolist(),f.volume.astype('int64').tolist())
  con.executemany('INSERT OR IGNORE INTO bars VALUES(?,?,?,?,?,?,?,?)',rows);con.commit();count+=len(f)
  print(f'Indexed {count:,} minute records',flush=True)
 con.execute('CREATE INDEX daily_symbol ON bars(day,symbol,time)')
 con.execute('CREATE TABLE volumes AS SELECT day,symbol,SUM(volume) volume FROM bars GROUP BY day,symbol');con.execute('CREATE INDEX volume_day ON volumes(day)');con.commit();con.close();temp.replace(target)
 print('Complete:',target,flush=True)
if __name__=='__main__':build(Path(json.loads((ROOT/'replay-source.json').read_text())['source']),ROOT/'replay-index.db')
