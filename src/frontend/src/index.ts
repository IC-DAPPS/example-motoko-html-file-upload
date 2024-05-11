import {
  BatchArg,
  FileInfo,
  idlFactory,
} from "../../declarations/backend/backend.did";
import { backend, createActor } from "../../declarations/backend/index";
import { Actor } from "../../../node_modules/@dfinity/agent/lib/cjs/actor";
import { Principal } from "../../../node_modules/@dfinity/principal/lib/cjs/index";
import { AuthClient } from "../../../node_modules/@dfinity/auth-client/lib/cjs/index";
import { HttpAgent } from "../../../node_modules/@dfinity/agent/lib/cjs/agent/http/index";

let file_g: File | undefined;
let fileHash_g: Uint8Array | undefined;
let fileChunks_g: Uint8Array[] = [];
let chunksHash_g: Uint8Array[] = [];

const fileInput = document.getElementById("fileInput") as HTMLInputElement;

fileInput.addEventListener("change", handleFileInput);

async function handleFileInput() {
  const file = fileInput.files?.[0];
  if (file) {
    file_g = file;
    // const chunkSize = 2 * 1024 * 1024; // 2MB in bytes
    const chunkSize = 1.9 * 1024 * 1024; // 1.9MB in bytes
    const fileChunks: Uint8Array[] = [];

    if (file.size <= chunkSize) {
      const chunk = await blobToUint8Array(file);
      fileChunks.push(chunk);
    } else {
      let offset = 0;
      while (offset < file.size) {
        const chunkBlob = file.slice(offset, offset + chunkSize);
        const chunk = await blobToUint8Array(chunkBlob);
        fileChunks.push(chunk);
        offset += chunkSize;
      }
    }

    fileChunks_g = fileChunks;

    handleFileHash(file);

    try {
      const hashes = await Promise.all(fileChunks.map(calculateChunksHash));
      console.log("Chunk Hashes:", hashes);
      chunksHash_g = hashes;
    } catch (error) {
      console.error("Error calculating hashes:", error);
    }

    toggleUploadButton();
  }
}

async function handleFileHash(file: File) {
  try {
    fileHash_g = await getFileHash(file);
  } catch (err) {
    console.error("Error getting file hash:", err);
  }
}

async function calculateChunksHash(chunk: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", chunk);
  return new Uint8Array(hashBuffer);
}

const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};

function getFileHash(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.readAsArrayBuffer(file);

    reader.onload = async () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        const hashObj = await crypto.subtle.digest("SHA-256", buffer);
        const hashArray = new Uint8Array(hashObj);
        resolve(hashArray);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(reader.error);
    };
  });
}

const preViewer = document.getElementById("preViewer") as HTMLDivElement;

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (file) {
    const reader = new FileReader();

    reader.onload = (event) => {
      const isImage = file.type.startsWith("image/");

      if (isImage) {
        preViewer.innerHTML = `<img src="${event.target?.result}" alt="Selected Image Preview" width="100%" height="100%">`;
      } else if (file.type === "application/pdf") {
        const fileURL = URL.createObjectURL(file);
        preViewer.innerHTML = `<iframe src="${fileURL}" width="100%" height="100%"></iframe>`;
      } else {
        preViewer.innerHTML = "Please select a PDF or image file.";
      }
    };

    reader.readAsDataURL(file);
  } else {
    preViewer.innerHTML = "";
  }
});

/////////////////////////////////////// Actor Part ///////////////////////////
let backendActor = backend;
let backendConnectedPrincipal: Principal | undefined = undefined;

(async () => {
  backendConnectedPrincipal = await Actor.agentOf(backendActor)?.getPrincipal();
  render_principal(backendConnectedPrincipal);
  // document.getElementById("principal").innerHTML = annotated_principal(
  //   backendConnectedPrincipal
  // );
})();

// Register user
(async () => {
  await registerIfNotRegistered();
})();

async function registerIfNotRegistered() {
  if (!(await backendActor.isUserRegistered())) {
    await backendActor.registerUser([]);
  }
}

const uploadButton = document.getElementById(
  "uploadButton"
) as HTMLButtonElement;
const uploadingAnimation = document.getElementById(
  "uploadingAnimation"
) as HTMLDivElement;

uploadButton.addEventListener("click", handleFileUpload);

function toggleUploadButton() {
  uploadButton.style.display = fileInput.files?.length ? "block" : "none";
}

async function handleFileUpload() {
  const file = fileInput.files?.[0];
  if (file) {
    uploadingAnimation.style.display = "block";

    await uploadToBackendCanister(
      file_g as File,
      fileChunks_g,
      fileHash_g as Uint8Array,
      chunksHash_g
    );

    uploadingAnimation.style.display = "none";
    fileInput.value = "";
    preViewer.innerHTML = "";
    toggleUploadButton();

    /// Render Files again
    await updateStoredFilesAndRenderFiles();
  }
}

async function uploadToBackendCanister(
  file: File,
  fileChunks: Uint8Array[],
  fileHash: Uint8Array,
  chunkHash: Uint8Array[]
) {
  const name = file.name;
  const sha256 = fileHash;
  const contentType = file.type;
  const chunksSha256 = chunkHash;
  const batchArgs: BatchArg = {
    sha256: [fileHash],
    contentType,
    chunksSha256,
    name,
  };

  const batchId = await backendActor.create_batch(batchArgs);
  await uploadChunks(fileChunks, batchId);
}

async function uploadChunks(fileChunks: Uint8Array[], batchId: bigint) {
  for (const chunk of fileChunks) {
    try {
      await backendActor.upload_chunk({ batchId, chunk });
      console.log("Chunk uploaded:", chunk);
    } catch (error) {
      console.error("Error uploading chunk:", error);
    }
  }
  console.log("All chunks uploaded (if no errors occurred).");
}

////////////////////////////////////////
///////Load All Files
let storedFiles: File[] = [];

async function getListOfFiles(): Promise<Array<FileInfo>> {
  const list: Array<FileInfo> = await backendActor.list();
  return list;
}
async function getFilesStoredInBackend(list: Array<FileInfo>) {
  const retrievedFiles = [];
  for (const { file_name } of list) {
    try {
      let response = await backendActor.get({ file_name });
      const { modified, content, sha256, chunks_left, content_type } = response;
      const chunkLeft = Number(chunks_left);
      const firstChunk = content;
      const chunks: Array<Uint8Array | number[]> = await getRemainingChunks(
        chunkLeft,
        firstChunk,
        file_name
      );
      const file = combineChunksToFile(chunks, file_name, content_type);
      retrievedFiles.push(file);
    } catch (error) {
      console.error("Error downloading first chunk:", error);
    }
  }
  storedFiles = retrievedFiles;
}

// if chunkLeft zero it will push firstChunk into array and returns. otherwise get other chunks.
async function getRemainingChunks(
  chunkLeft: number,
  firstChunk: Uint8Array | number[],
  file_name: string
): Promise<Array<Uint8Array | number[]>> {
  let chunks: Array<Uint8Array | number[]> = [];
  chunks.push(firstChunk);

  for (let i = 1; i <= chunkLeft; i++) {
    try {
      const index = BigInt(i);
      const { content } = await backendActor.get_chunk({ file_name, index });
      chunks.push(content);
    } catch (error) {
      console.error("Error downloading chunk:", error);
    }
  }
  return chunks;
}

function combineChunksToFile(
  chunks: Array<Uint8Array | number[]>,
  fileName: string,
  contentType: string
): File {
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combinedArray = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    if (chunk instanceof Uint8Array) {
      combinedArray.set(chunk, offset);
    } else {
      combinedArray.set(new Uint8Array(chunk), offset);
    }
    offset += chunk.length;
  }

  const blob = new Blob([combinedArray], { type: contentType });
  const file = new File([blob], fileName, { type: blob.type });

  return file;
}

async function updateStoredFilesAndRenderFiles() {
  const list = await getListOfFiles();
  await getFilesStoredInBackend(list);
  await displayFiles(storedFiles);
}

// (async () => {
//   await updateStoredFilesAndRenderFiles();
// })();

///////////////////////////////////////
///// Render stored Files
interface FileWithPreview extends File {
  preview: string | null;
}

function generatePreview(file: File): Promise<FileWithPreview> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const preview = reader.result as string;
      const fileWithPreview: FileWithPreview = { ...file, preview };
      resolve(fileWithPreview);
    };
    reader.onerror = () => {
      reject(new Error("Error generating preview"));
    };

    if (file.type.startsWith("image/")) {
      reader.readAsDataURL(file);
    } else if (file.type === "application/pdf") {
      reader.readAsDataURL(file);
    } else {
      resolve({ ...file, preview: null });
    }
  });
}

// async function displayFiles(files: File[]) {
//   const container = document.createElement("div");
//   container.style.display = "flex";
//   container.style.flexWrap = "wrap";

//   for (const file of files) {
//     const fileWithPreview = await generatePreview(file);

//     if (fileWithPreview.preview) {
//       const preview = document.createElement("div");
//       preview.style.margin = "10px";
//       preview.style.border = "1px solid #ccc";
//       preview.style.borderRadius = "5px";
//       preview.style.maxWidth = "200px";
//       preview.style.maxHeight = "200px";
//       preview.style.display = "flex";
//       preview.style.alignItems = "center";
//       preview.style.justifyContent = "center";
//       preview.style.overflow = "hidden";

//       const img = document.createElement("img");
//       img.src = fileWithPreview.preview;
//       img.style.maxWidth = "100%";
//       img.style.maxHeight = "100%";
//       img.style.objectFit = "contain";

//       const iframe = document.createElement("iframe");
//       iframe.src = fileWithPreview.preview;
//       iframe.style.width = "100%";
//       iframe.style.height = "100%";
//       iframe.style.border = "none";

//       if (file.type.startsWith("image/")) {
//         preview.appendChild(img);
//       } else if (file.type === "application/pdf") {
//         preview.appendChild(iframe);
//       }

//       container.appendChild(preview);
//     }
//   }

//   document.body.appendChild(container);
// }

///??????????????????????????????????/////

// const principal = document.getElementById("principal") as HTMLLabelElement;
// principal.innerHTML = annotated_principal(backendConnectedPrincipal);

async function displayFiles(files: File[]) {
  const previewsContainer = document.getElementById("previews") as HTMLElement;
  previewsContainer.innerHTML = ""; // Clear previous previews

  for (const file of files) {
    const fileWithPreview = await generatePreview(file);

    if (fileWithPreview.preview) {
      const preview = document.createElement("div");
      preview.style.margin = "10px";
      preview.style.border = "1px solid #ccc";
      preview.style.borderRadius = "5px";
      preview.style.maxWidth = "200px";
      preview.style.maxHeight = "200px";
      preview.style.display = "flex";
      preview.style.alignItems = "center";
      preview.style.justifyContent = "center";
      preview.style.overflow = "hidden";

      const img = document.createElement("img");
      img.src = fileWithPreview.preview;
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";

      const iframe = document.createElement("iframe");
      iframe.src = fileWithPreview.preview;
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "none";

      if (file.type.startsWith("image/")) {
        preview.appendChild(img);
      } else if (file.type === "application/pdf") {
        preview.appendChild(iframe);
      }

      previewsContainer.appendChild(preview);
    }
  }
}

function render_principal(principal: Principal | undefined) {
  const principalE = document.getElementById("principal") as HTMLLabelElement;
  principalE.innerHTML = annotated_principal(principal);
}

function annotated_principal(principal: Principal | undefined): string {
  if (principal) {
    const principal_string = principal.toString();
    if (principal_string === "2vxsx-fae") {
      return "Anonymous principal (2vxsx-fae)";
    } else {
      return `Principal: ${principal_string}`;
    }
  }
  return "";
}

/// Login / Log Out

let authClient: AuthClient | null | undefined;
let isAuthenticated: boolean = false;

const loginElement = document.getElementById("login") as HTMLElement;

loginElement.onclick = async (e) => {
  e.preventDefault();
  authClient = authClient ?? (await AuthClient.create());

  isAuthenticated = await authClient.isAuthenticated();

  if (!isAuthenticated) {
    await new Promise<void>(async (resolve, reject) => {
      authClient?.login({
        identityProvider: `http://${process.env.CANISTER_ID_INTERNET_IDENTITY}.localhost:4943/`,
        onSuccess: async () => {
          isAuthenticated = (await authClient?.isAuthenticated())
            ? true
            : false;

          console.log("not working");
          await backend_actor_and_principal_login_logOut_handle();
          await updateStoredFilesAndRenderFiles();
          resolve();
        },
        onError: reject,
      });
    });
  } else {
    authClient.logout();

    authClient = null;
    isAuthenticated = false;
    await backend_actor_and_principal_login_logOut_handle();
  }
};

async function backend_actor_and_principal_login_logOut_handle() {
  if (isAuthenticated) {
    const identity = authClient?.getIdentity();

    const host =
      process.env.DFX_NETWORK === "local"
        ? "http://127.0.0.1:4943"
        : "https://icp0.io";

    const agent = new HttpAgent({ identity, host });
    if (process.env.DFX_NETWORK === "local") {
      await agent.fetchRootKey();
    }
    const canisterId = process.env.CANISTER_ID_BACKEND as string;
    // backendActor = Actor.createActor(idlFactory, { canisterId, agent });
    backendActor = createActor(canisterId, { agent });

    backendConnectedPrincipal = identity?.getPrincipal();
    render_principal(backendConnectedPrincipal);
    loginElement.innerHTML = "( Logout )";

    // //// register user
    await registerIfNotRegistered();
  } else {
    backendActor = backend;
    backendConnectedPrincipal = await Actor.agentOf(
      backendActor
    )?.getPrincipal();

    render_principal(backendConnectedPrincipal);
    loginElement.innerHTML = "( Login )";
  }
}
