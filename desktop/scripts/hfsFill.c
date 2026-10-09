// Preenche um volume HFS+ preservando links e permissões (o "addall" do libdmg-hfsplus segue links e perde o +x).
// Lê do stdin linhas separadas por tab:  D <caminho> <modo> | F <caminho> <modo> <origem> | L <caminho> <alvo> | I <caminho> | R <caminho> | C <pasta com ícone próprio>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <hfs/hfsplus.h>
#include <hfs/hfslib.h>
#include "abstractfile.h"

char endianness;

static int fail(const char *what, const char *path) {
  fprintf(stderr, "hfsFill: %s: %s\n", what, path);
  return 1;
}

int main(int argc, const char *argv[]) {
  if (argc < 2) return fail("uso", "hfsFill <imagem> < lista");
  short probe = 1;
  endianness = *(char *)&probe ? IS_LITTLE_ENDIAN : IS_BIG_ENDIAN;
  io_func *io = openFlatFile(argv[1]);
  if (!io) return fail("não abriu a imagem", argv[1]);
  Volume *volume = openVolume(io);
  if (!volume) return fail("volume inválido", argv[1]);

  char line[8192];
  int rc = 0;
  while (!rc && fgets(line, sizeof line, stdin)) {
    line[strcspn(line, "\n")] = 0;
    char *kind = strtok(line, "\t"), *path = strtok(NULL, "\t"), *a = strtok(NULL, "\t"), *b = strtok(NULL, "\t");
    if (!kind || !path) continue;
    if (kind[0] == 'D') {
      if (!newFolder(path, volume)) rc = fail("pasta", path);
      else chmodFile(path, (int)strtol(a, NULL, 8), volume);
    } else if (kind[0] == 'F') {
      FILE *src = fopen(b, "rb");
      if (!src) { rc = fail("origem", b); break; }
      if (!add_hfs(volume, createAbstractFileFromFile(src), path)) rc = fail("arquivo", path);
      else chmodFile(path, (int)strtol(a, NULL, 8), volume);
    } else if (kind[0] == 'L') {
      if (!makeSymlink(path, a, volume)) rc = fail("link", path);
    } else if (kind[0] == 'I') {
      HFSPlusCatalogRecord *rec = getRecordFromPath(path, volume, NULL, NULL);
      if (!rec) { rc = fail("não encontrado", path); break; }
      unsigned id = rec->recordType == kHFSPlusFolderRecord ? ((HFSPlusCatalogFolder *)rec)->folderID : ((HFSPlusCatalogFile *)rec)->fileID;
      printf("%u\t%s\n", id, path);
      free(rec);
    } else if (kind[0] == 'C') {
      HFSPlusCatalogRecord *rec = getRecordFromPath(path, volume, NULL, NULL);
      if (!rec || rec->recordType != kHFSPlusFolderRecord) { rc = fail("pasta ausente", path); break; }
      ((HFSPlusCatalogFolder *)rec)->userInfo.finderFlags |= kHasCustomIcon;
      updateCatalog(volume, rec);
      free(rec);
    } else if (kind[0] == 'R') {
      HFSPlusCatalogRecord *rec = getRecordFromPath3(path, volume, NULL, NULL, TRUE, FALSE, kHFSRootFolderID);
      if (!rec || rec->recordType != kHFSPlusFileRecord) { rc = fail("link ausente", path); break; }
      void *buf = malloc(1);
      size_t len = 0;
      writeToFile((HFSPlusCatalogFile *)rec, createAbstractFileFromMemoryFile(&buf, &len), volume);
      printf("%.*s\t%s\n", (int)len, (char *)buf, path);
      free(buf);
      free(rec);
    }
  }
  closeVolume(volume);
  CLOSE(io);
  return rc;
}
