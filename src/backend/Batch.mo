import Time "mo:base/Time";
import HashMap "mo:base/HashMap";
import Buffer "mo:base/Buffer";
import Timer "mo:base/Timer";
import Debug "mo:base/Debug";
import Nat64 "mo:base/Nat64";

import Sha256 "mo:sha2/Sha256";

module {

    type File = {
        modified : Nat64;
        // name : Text;
        contentType : Text;
        content : [Blob];
        sha256 : ?Blob;
    };

    // type B_atch = {
    //     uploader : Principal; //
    //     chunksSha256 : [Blob];
    //     name : Text; //
    //     contentType : Text; //
    //     sha256 : ?Blob; //
    //     chunks : Buffer.Buffer<Blob>; //
    //     timerId : Nat; //
    //     expiresAt : Time.Time; //
    //     refreshExpiry : () -> ();//
    //     addChunk : (chunk : Blob) -> ();//
    // };

    public type InitBatch = {
        batchId : Nat;
        uploader : Principal;
        chunksSha256 : [Blob];
        name : Text;
        contentType : Text;
        sha256 : ?Blob;
    };

    public class Batch<system>(init : InitBatch, batches : HashMap.HashMap<Nat, Batch>, filesStored : HashMap.HashMap<Text, File>) {
        let numberOfChunks : Nat = init.chunksSha256.size();
        if (numberOfChunks == 0) { Debug.trap("chunksSha256 can not be empty") };
        let chunks = Buffer.Buffer<Blob>(numberOfChunks);

        public let uploader : Principal = init.uploader;
        public let name = init.name;
        public let contentType = init.contentType;
        public let sha256 = init.sha256;

        let expireWitIn5MinNanos : Nat = 5 * 60 * 1000 * 1000 * 1000;

        var expiresAt = Time.now() + expireWitIn5MinNanos;

        // Timer for auto-deleting batches that fail to upload all chunks within a 5-minute interval per chunk.
        public var timerId = do {
            Timer.setTimer<system>(
                #nanoseconds expireWitIn5MinNanos,
                func() : async () {
                    batches.delete(init.batchId);
                },
            );
        };

        // Restart Timer and update expiry
        func refreshExpiry<system>() {
            Timer.cancelTimer(timerId);
            expiresAt := Time.now() + expireWitIn5MinNanos;

            timerId := Timer.setTimer<system>(
                #nanoseconds expireWitIn5MinNanos,
                func() : async () { batches.delete(init.batchId) },
            );
        };

        // To delete batches that have completed uploading all chunks.
        func deleteBatch() {
            // if (chunks.size() == init.chunksSha256.size()) {
            Timer.cancelTimer(timerId);
            batches.delete(init.batchId);
            // };
        };

        // Store the file once all chunks have been uploaded successfully.
        func storeFile() {
            // if (chunks.size() == init.chunksSha256.size()) {
            let file : File = {
                modified = Nat64.fromIntWrap(Time.now());
                contentType = init.contentType;
                content = Buffer.toArray(chunks);
                sha256;
            };
            filesStored.put(name, file);
            // };
        };

        // Uploading Chunks
        public func addChunk<system>(chunk : Blob) {
            if (Time.now() > expiresAt) { Debug.trap("Batch Expired") };
            let uploadedChunkSha256 = Sha256.fromBlob(#sha256, chunk);

            if (uploadedChunkSha256 != init.chunksSha256[chunks.size()]) {
                Debug.trap("Error: Chunk hash mismatch!");
            };
            chunks.add(chunk);

            if (chunks.size() < init.chunksSha256.size()) {
                refreshExpiry<system>();
            } else {
                storeFile();
                deleteBatch();
            };
        };

    };
};
