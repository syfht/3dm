import { useState } from "react";
import LoadingScreen from "./LoadingScreen";
import StartScreen from "./StartScreen";
import TerrainGame from "./TerrainGame";

export default function GameShell() {
  const [username, setUsername] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [ready, setReady] = useState(false);
  const [barFull, setBarFull] = useState(false);
  const loaded = ready && barFull;

  return (
    <>
      <TerrainGame
        username={username ?? "Player"}
        disabled={!username}
        onProgress={setPercent}
        onReady={() => setReady(true)}
      />
      {!loaded && <LoadingScreen percent={percent} onFull={() => setBarFull(true)} />}
      {loaded && !username && <StartScreen onStart={setUsername} />}
    </>
  );
}
