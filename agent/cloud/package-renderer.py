"""Wrap the vendor renderer while retaining executable binary permissions."""
import copy
import pathlib
import zipfile

with zipfile.ZipFile("build/remotion-renderer.zip") as source:
    with zipfile.ZipFile("build/remotion-private-renderer.zip", "w", zipfile.ZIP_DEFLATED) as target:
        for original in source.infolist():
            entry = copy.copy(original)
            if entry.filename == "index.js":
                entry.filename = "remotion-renderer.js"
            target.writestr(entry, source.read(original))
        target.write("renderer-wrapper.cjs", "index.js")
print("Private renderer archive:", pathlib.Path("build/remotion-private-renderer.zip").stat().st_size)
