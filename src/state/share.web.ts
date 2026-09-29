// «Поделиться» в веб-версии (docs/specs/2026-09-web.md): PNG скачивается файлом — у компьютера
// нет системного «Поделиться», которое примет картинку наверняка.
export async function sharePng(bytes: Uint8Array, name: string, _title: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/png' }));
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
