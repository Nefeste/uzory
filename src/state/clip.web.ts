// Текст — в буфер обмена браузера; нет доступа к буферу — false: текст остаётся на экране.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
