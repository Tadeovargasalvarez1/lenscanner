# Folio

Escáner documental web, local y privado. El proyecto se publica como sitio estático; las imágenes, los PDF y el OCR permanecen en el dispositivo.

## Desarrollo

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
```

## GitHub Pages

El workflow de `.github/workflows/deploy.yml` compila y publica `dist` en GitHub Pages al hacer push a `main` o `master`. Vite utiliza `base: './'`, por lo que los assets funcionan bajo `https://usuario.github.io/nombre-repositorio/`. En la configuración del repositorio, selecciona **Settings → Pages → GitHub Actions**.

## Decisiones y límites actuales

- La captura usa `ImageCapture.takePhoto()` cuando el navegador lo permite y cae a canvas/video o selector de archivos.
- La detección se ejecuta sobre una copia reducida con contornos y aproximación de cuadriláteros en OpenCV.js cargado de forma diferida; mantiene un fallback local de gradientes y solo acepta geometrías con confianza suficiente. El warp final se realiza sobre la foto de alta resolución disponible.
- La normalización de iluminación, reducción de sombras, contraste local, escala de grises, binarización adaptativa y enfoque se hacen con Canvas, sin enviar datos a servidores.
- OCR se carga de forma diferida con Tesseract.js. El PDF generado es un PDF de imágenes; el texto OCR se guarda y exporta por separado. No se presenta como PDF buscable hasta contar con cajas de texto OCR fiables.
- El soporte de torch, Web Share, ImageCapture, vibración, OffscreenCanvas y cámara depende del navegador/dispositivo y se oculta o degrada con seguridad.
- OpenCV.js se carga únicamente al detectar un documento, fuera del bundle inicial; la carga pesada queda diferida para mantener rápida la pantalla principal.
