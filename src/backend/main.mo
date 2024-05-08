import Nat "mo:base/Nat";
import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import Bool "mo:base/Bool";
import Buffer "mo:base/Buffer";
import Result "mo:base/Result";
import Debug "mo:base/Debug";
import Text "mo:base/Text";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Hash "mo:base/Hash";

import Batch "Batch";
import U "Utils";

actor {

  type BatchId = Nat;
  type Result<Ok, Err> = Result.Result<Ok, Err>;
  type FileName = Text;

  type Batch = Batch.Batch;

  type File = {
    modified : Nat64;
    // name : Text;
    contentType : Text;
    content : [Blob];
    sha256 : ?Blob;
  };

  type BatchArg = {
    chunksSha256 : [Blob];
    name : Text;
    contentType : Text;
    sha256 : ?Blob;
  };

  type UploadChunkArg = {
    batchId : Nat;
    chunk : Blob;
  };

  // type Batch = {
  //   uploader : Principal;
  //   chunksSha256 : [Blob];
  //   name : Text;
  //   contentType : Text;
  //   sha256 : Blob;
  //   chunks : [Blob];
  //   timerId : Nat;
  //   expiresAt : Time.Time;
  //   refreshExpiry : () -> ();
  //   addChunk : (chunk : Blob) -> ();
  // };

  stable var persistedUserRegisrty : [Principal] = [];
  stable var persistedFilesStored : [(Text, File)] = [];
  stable var nextBatchId : Nat = 1;

  let usersRegistry = Buffer.Buffer<Principal>(0);
  let filesStored = HashMap.HashMap<Text, File>(1, Text.equal, Text.hash);
  let batches = HashMap.HashMap<BatchId, Batch>(3, Nat.equal, U.natHash);

  func isRegistered(caller : Principal) : Bool {
    Buffer.contains(usersRegistry, caller, Principal.equal);
  };

  func trapAnonymous(caller : Principal) : () {
    if (Principal.isAnonymous(caller)) {
      Debug.trap("Anonymous caller");
    };
  };

  func trapUnregistered(caller : Principal) : () {
    if (not isRegistered caller) {
      Debug.trap("Unregistered caller");
    };
  };

  func trapDuplicateRegister(caller : Principal) : () {
    if (isRegistered caller) { Debug.trap("Already Registered") };
  };

  system func preupgrade() {
    persistedUserRegisrty := Buffer.toArray(usersRegistry);
    persistedFilesStored := Iter.toArray(filesStored.entries());
  };

  system func postupgrade() {
    // clear everything after updrage
    for (userP in persistedUserRegisrty.vals()) {
      usersRegistry.add(userP);
    };
    persistedUserRegisrty := [];

    for ((fileName, file) in persistedFilesStored.vals()) {
      filesStored.put(fileName, file);
    };

    persistedFilesStored := [];
  };

  public shared ({ caller }) func registerUser(reg : ?Principal) : async () {
    trapAnonymous caller;
    trapDuplicateRegister caller;
    switch (reg) {
      case (?p) { trapAnonymous(caller); usersRegistry.add(p) };
      case (null) { usersRegistry.add(caller) };
    };

  };

  public shared ({ caller }) func create_batch(args : BatchArg) : async BatchId {
    trapAnonymous caller;
    trapUnregistered caller;
    let batchId = nextBatchId;
    let subArg = { batchId; uploader = caller };
    let batch : Batch = Batch.Batch<system>({ args and subArg }, batches, filesStored);

    batches.put(batchId, batch);
    nextBatchId += 1;
    return batchId;
  };

  public shared ({ caller }) func upload_chunk(_args : UploadChunkArg) : async () {};

};
