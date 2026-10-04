/**
 * QR 스캔(UI-DSH-14 [QR 스캔], UI-DEV-21 ①): 브라우저 BarcodeDetector가 있으면 후면 카메라로 읽고, 없거나 카메라를 거부하면
 * 라벨 아래 주소·토큰을 직접 넣는다. 카메라 거부 시 "설정에서 카메라를 허용하세요"(UI-DSH-14 상태). 외부 디코더 라이브러리는 쓰지 않는다.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, TextField } from "~/components/ui";
import { qrTokenFrom } from "../model/commissioning";

export const SCAN_INTERVAL_MS = 300;

export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

export interface ScannerDeps {
  /** BarcodeDetector 대역. 없으면 카메라 스캔을 끈다 */
  createDetector?: () => Detector | null;
  getMedia?: () => Promise<MediaStream>;
}

function browserDetector(): Detector | null {
  const Ctor = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  return Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
}

function browserMedia(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
}

export function QrScanner({ onToken, deps = {} }: { onToken: (token: string) => void; deps?: ScannerDeps }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"idle" | "on" | "denied" | "unsupported">("idle");
  const [manual, setManual] = useState("");
  const [invalid, setInvalid] = useState(false);
  const handled = useRef(false);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (camera !== "on") return;
    const detector = (deps.createDetector ?? browserDetector)();
    if (!detector) {
      setCamera("unsupported");
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    void (deps.getMedia ?? browserMedia)()
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play?.()?.catch?.(() => undefined);
        }
        timer = setInterval(() => {
          if (!video.current || handled.current) return;
          void detector
            .detect(video.current)
            .then((codes) => {
              const token = codes.map((c) => qrTokenFrom(c.rawValue)).find(Boolean);
              if (token && !handled.current) {
                handled.current = true;
                onTokenRef.current(token);
              }
            })
            .catch(() => undefined);
        }, SCAN_INTERVAL_MS);
      })
      .catch(() => alive && setCamera("denied"));
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camera, deps]);

  const submit = () => {
    const token = qrTokenFrom(manual);
    setInvalid(!token);
    if (token) onToken(token);
  };

  return (
    <div className="flex flex-col gap-3">
      {camera === "on" && (
        <video ref={video} muted playsInline aria-label={t("field.scan.camera")} className="aspect-square w-full rounded-lg bg-black object-cover" />
      )}
      {camera === "denied" && <Alert tone="warning">{t("field.scan.denied")}</Alert>}
      {camera === "unsupported" && <Alert tone="info">{t("field.scan.unsupported")}</Alert>}
      {camera !== "on" && (
        <Button
          variant="primary"
          className="min-h-11"
          onClick={() => {
            handled.current = false;
            setCamera("on");
          }}
        >
          {t("field.scan.start")}
        </Button>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField label={t("field.scan.manual")} value={manual} error={invalid ? t("field.scan.invalid") : undefined} onChange={(e) => setManual(e.target.value)} />
        <Button type="submit" className="min-h-11">
          {t("field.scan.open")}
        </Button>
      </form>
    </div>
  );
}
