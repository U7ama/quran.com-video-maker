"""Transfer deployment files using short-lived URLs supplied on stdin.

Does not read AWS credentials or print URLs, configuration, or response bodies.
"""
import concurrent.futures
import json
import pathlib
import sys
import urllib.request

requests = json.loads(sys.stdin.readline())

def transfer(item):
    file = pathlib.Path(item["file"])
    headers = item.get("headers", {})
    if item.get("operation") == "download":
        file.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(item["url"], headers=headers, method="GET")
        with urllib.request.urlopen(request, timeout=240) as response:
            with file.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        file.chmod(0o600)
        return {"key": item["key"], "bytes": file.stat().st_size, "status": "downloaded"}
    request = urllib.request.Request(item["url"], data=file.read_bytes(), headers=headers, method="PUT")
    with urllib.request.urlopen(request, timeout=240) as response:
        if response.status != 200:
            raise RuntimeError("Deployment transfer was not accepted")
    return {"key": item["key"], "bytes": file.stat().st_size, "status": "uploaded"}

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    for result in executor.map(transfer, requests):
        print(json.dumps(result), flush=True)
