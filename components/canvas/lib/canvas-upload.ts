/**
 * Upload a File to S3 via the project uploads API, returns the CDN URL.
 */
export async function uploadFileToS3(file: File, projectId: number): Promise<string> {
  const base64 = await fileToBase64(file);

  const res = await fetch(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageData: base64,
      fileName: file.name,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed (${res.status})`);
  }

  const data = await res.json();
  return data.image_url;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
