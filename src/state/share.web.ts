// «Поделиться» в веб-версии (docs/specs/2026-09-web.md): файл скачивается — у компьютера нет
// системного «Поделиться», которое примет картинку или файл работ наверняка.
export async function shareFile(bytes: Uint8Array, name: string, mimeType: string, _title: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
