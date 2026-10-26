# C言語学習動画ツール

仕様と検証状況は、[MVP仕様書](C言語学習動画ツール_MVP仕様.md)と[検証計画](C言語学習動画ツール_検証計画.md)を参照してください。Electronアプリとテストは`vrm-spike/`にあります。

## GitHubに保存するもの

- 仕様書、検証計画、README
- `vrm-spike/src/`、`vrm-spike/electron/`、`vrm-spike/test/`
- `vrm-spike/package.json`と`package-lock.json`、TypeScript設定、HTML/CSS

## PCごとに用意するもの

- `C1.vrm`などのVRMモデルとVRMAモーション。権利と社内ルールを確認し、必要なPCへ個別に配置します。モデルはGitHubへ登録しません。
- 一部の描画E2Eが使う`vrm-spike/test-results/voicevox-mouth-timeline.json`。`three-vrm-test.vrma`は`test:material-freshness-ui`がOS一時フォルダーに合成fixtureとして生成し、テスト終了時に削除します。検証用生成物はGitHubへ登録しません。
- GCC、VOICEVOX Engine、製品用FFmpegなどの外部ソフト。
- APIトークンや`.env`などの認証情報。GitHub、プロジェクトJSON、ログ、Git remote URLへ記録しません。GitHub認証にはGit Credential Managerなどの資格情報管理を使います。

`node_modules/`、`dist/`、`test-results/`、生成MP4/SRT/WAV、`.vscode/`の端末固有設定もコミットしません。`.gitignore`は追跡済みファイルには適用されないため、既に追跡されているローカル資産を除外する場合は、作業ファイルを残したままGitの追跡対象から別途外してください。

## 別PCでの起動

Windows 11 x64とNode.js 24.xを用意します。リポジトリを取得したあと、PowerShellで次を実行します。

```powershell
cd .\vrm-spike
npm.cmd ci
npm.cmd run typecheck
npm.cmd run build
npm.cmd run dev
```

Copilot SDKによる実シナリオ生成には、Copilotを利用できるGitHubアカウントでの認証が必要です。C実行にはMSYS2 UCRT64 GCC、音声生成には別途起動したVOICEVOX Engineが必要です。製品用MP4書き出しには、`libx264`と`aac`を含むFFmpegをPATHへ設定してください。

## テスト

依存関係のない契約テストやサービス単体テストは、対応する`npm.cmd run test:*`スクリプトを実行します。Electron描画E2Eの一部は、リポジトリ直下の`C1.vrm`と上記の`test-results/`資材を必要とします。実音声のE2EにはVOICEVOX Engineを起動し、次を実行します。

```powershell
$env:CVIDEO_VIDEO_EXPORT_VOICEVOX = '1'
npm.cmd run test:video-export-e2e
```

MP4 Electron E2Eの完了ログと終了コードは`vrm-spike/test-results/video-export-last-run.json`に記録されます。別の保存先を使う場合は、npmへ`-- --report-file=<path>`を渡します。

実機の前提、追加資材、検証コマンドは検証計画書で管理します。個人のCopilot認証や会社APIキーなどの秘密情報は、テスト資材として保存しないでください。