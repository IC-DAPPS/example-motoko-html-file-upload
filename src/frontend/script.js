const fileInput = document.getElementById("fileInput");

fileInput.addEventListener("change", handleFileUpload);

function handleFileUpload() {
  const file = fileInput.files[0];
  console.log("This is file", file);
  const chunkSize = 2 * 1024 * 1024; // 2MB in bytes
  const fileChunks = [];

  if (file.size <= chunkSize) {
    fileChunks.push(file);
  } else {
    let offset = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      fileChunks.push(chunk);
      offset += chunkSize;
    }
  }

  fileChunks.forEach((chunk__, index) => {
    console.log("Chunk ", index + 1, "  :  ", chunk__);
  });

  const hashPromises = fileChunks.map(calculateHash);
  Promise.all(hashPromises)
    .then((hashes) => {
      console.log("File Chunks:", fileChunks);
      console.log("Chunk Hashes:", hashes);
    })
    .catch((error) => console.error("Error calculating hashes:", error));
}

function calculateHash(chunk) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result;
      crypto.subtle
        .digest("SHA-256", buffer)
        .then((hashBuffer) => {
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          resolve(hashHex);
        })
        .catch((error) => reject(error));
    };
    reader.readAsArrayBuffer(chunk);
  });
}

///////////////////////
// Function to get the hash of a file
function getFileHash(file) {
  return new Promise((resolve, reject) => {
    // Create a FileReader object
    const reader = new FileReader();

    // Read the file as an ArrayBuffer
    reader.readAsArrayBuffer(file);

    // When the file is loaded
    reader.onload = async () => {
      try {
        // Get the ArrayBuffer from the FileReader
        const buffer = reader.result;

        // Create a hash object using the desired algorithm (e.g., SHA-256)
        const hashObj = await crypto.subtle.digest("SHA-256", buffer);
        console.log(hashObj);

        // Convert the hash to a hexadecimal string
        const hashHex = Array.from(new Uint8Array(hashObj))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        resolve(hashHex);
      } catch (err) {
        reject(err);
      }
    };

    // Handle errors
    reader.onerror = () => {
      reject(reader.error);
    };
  });
}

// Example usage
const fileInput1 = document.getElementById("file-input");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (file) {
    try {
      const hash = await getFileHash(file);
      console.log(`File hash (SHA-256): ${hash}`);
    } catch (err) {
      console.error("Error getting file hash:", err);
    }
  }
  console.log("))))))))))))))))))))))))))))))))))))))))");
});

/// Render Pdf

const pdfViewer = document.getElementById("pdfViewer");

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file && file.type === "application/pdf") {
    const fileURL = URL.createObjectURL(file);
    pdfViewer.innerHTML = `<iframe src="${fileURL}" width="100%" height="100%"></iframe>`;
  } else {
    pdfViewer.innerHTML = "Please select a PDF file.";
  }
});
