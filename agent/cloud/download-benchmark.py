"""Download only an isolated benchmark using bounded parallel HTTP ranges.
Signed URLs arrive on stdin and never enter output.
"""
import concurrent.futures,json,pathlib,urllib.request,math,hashlib
item=json.loads(input())
total=int(item['bytes'])
if total<1 or total>350*1024*1024:raise RuntimeError('Unexpected benchmark size')
target=pathlib.Path('build/stock-benchmark/stock-master.mp4')
size=16*1024*1024
parts=list(range(math.ceil(total/size)))
def fetch(index):
 start=index*size;end=min(total-1,start+size-1)
 file=target.with_suffix(f'.part-{index}')
 request=urllib.request.Request(item['url'],headers={'Range':f'bytes={start}-{end}'})
 with urllib.request.urlopen(request,timeout=240) as response:
  if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{total}':raise RuntimeError('Range response mismatch')
  with file.open('wb') as output:
   while chunk:=response.read(1024*1024):output.write(chunk)
 if file.stat().st_size!=end-start+1:raise RuntimeError('Incomplete benchmark range')
 return file
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
 results=list(executor.map(fetch,parts))
checksum=hashlib.sha256()
with target.open('wb') as output:
 for file in results:
  with file.open('rb') as part:
   while chunk:=part.read(1024*1024):output.write(chunk);checksum.update(chunk)
  file.unlink()
target.chmod(0o600)
if target.stat().st_size!=total:raise RuntimeError('Final benchmark size mismatch')
print(json.dumps({'downloadedBytes':total,'sha256':checksum.hexdigest()}))
