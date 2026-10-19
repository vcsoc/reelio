use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, GenericImageView, ImageReader,
    Limits, Rgb, RgbImage,
};
use reelio_domain::Artwork;
use serde::{Deserialize, Serialize};
use std::io::Cursor;

pub const MAX_DOWNLOAD: usize = 8 * 1024 * 1024;
const MAX_PIXELS: u64 = 8_388_608;
const MAX_JPEG: usize = 2 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resize {
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ImageEdits {
    pub crop: Option<Crop>,
    pub rotation: u16,
    pub flip: bool,
    pub grayscale: bool,
    pub negative: bool,
    pub sepia: bool,
    pub brightness: f32,
    pub contrast: f32,
    pub resize: Option<Resize>,
}
impl Default for ImageEdits {
    fn default() -> Self {
        Self {
            crop: None,
            rotation: 0,
            flip: false,
            grayscale: false,
            negative: false,
            sepia: false,
            brightness: 1.0,
            contrast: 1.0,
            resize: None,
        }
    }
}
fn dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        Err("Image exceeds supported dimensions (8192 per edge, 8 megapixels total)".into())
    } else {
        Ok(())
    }
}
fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.is_empty() || bytes.len() > MAX_DOWNLOAD {
        return Err("Image must be between 1 byte and 8 MiB".into());
    }
    let format = image::guess_format(bytes).map_err(|_| "Select a JPEG, PNG, or WebP image")?;
    if !matches!(
        format,
        image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP
    ) {
        return Err("Only JPEG, PNG, and WebP artwork are supported".into());
    }
    let reader = ImageReader::with_format(Cursor::new(bytes), format);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("Invalid image header: {e}"))?;
    dimensions(width, height)?;
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("Image could not be decoded safely: {e}"))
}
fn white_background(image: DynamicImage) -> DynamicImage {
    let rgba = image.to_rgba8();
    let rgb = RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y);
        let a = u32::from(p[3]);
        Rgb([0, 1, 2].map(|i| ((u32::from(p[i]) * a + 255 * (255 - a) + 127) / 255) as u8))
    });
    DynamicImage::ImageRgb8(rgb)
}
fn encode(image: DynamicImage, source_label: String) -> Result<Artwork, String> {
    let image = white_background(image);
    let mut bytes = vec![];
    JpegEncoder::new_with_quality(&mut bytes, 88)
        .encode_image(&image)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_JPEG {
        return Err("Edited cover exceeds 2 MiB. Reduce its dimensions.".into());
    }
    Ok(Artwork {
        jpeg: STANDARD.encode(bytes),
        width: image.width(),
        height: image.height(),
        source_label: source_label.chars().take(512).collect(),
    })
}
pub fn prepare(bytes: &[u8], source_label: &str) -> Result<Artwork, String> {
    let image = decode(bytes)?;
    let mut last_error = String::new();
    for edge in [2048, 1600, 1280, 1024, 768] {
        let prepared = if image.width() > edge || image.height() > edge {
            image.resize(edge, edge, FilterType::Lanczos3)
        } else {
            image.clone()
        };
        match encode(prepared, source_label.into()) {
            Ok(art) => return Ok(art),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}
pub fn jpeg_bytes(art: &Artwork) -> Result<Vec<u8>, String> {
    art.validate()?;
    let bytes = STANDARD
        .decode(&art.jpeg)
        .map_err(|_| "Artwork contains invalid base64")?;
    if bytes.len() > MAX_JPEG || image::guess_format(&bytes).ok() != Some(image::ImageFormat::Jpeg)
    {
        return Err("Project artwork must be a JPEG smaller than 2 MiB".into());
    }
    let image = decode(&bytes)?;
    if image.dimensions() != (art.width, art.height) {
        return Err("Artwork dimensions do not match its image payload".into());
    }
    Ok(bytes)
}
pub fn crop_to_ratio(art: &Artwork, width: u32, height: u32) -> Result<Artwork, String> {
    if width == 0 || height == 0 || width > 100 || height > 100 {
        return Err("Invalid cover proportion".into());
    }
    let (mut a, mut b) = (width, height);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    let (width, height) = (width / a, height / a);
    let scale = (art.width / width).min(art.height / height);
    if scale == 0 {
        return Err("Image is too small for the selected proportion".into());
    }
    let (w, h) = (scale * width, scale * height);
    if (w, h) == (art.width, art.height) {
        jpeg_bytes(art)?;
        return Ok(art.clone());
    }
    edit(
        art,
        &ImageEdits {
            crop: Some(Crop {
                x: (art.width - w) / 2,
                y: (art.height - h) / 2,
                width: w,
                height: h,
            }),
            ..Default::default()
        },
    )
}
pub fn edit(art: &Artwork, edits: &ImageEdits) -> Result<Artwork, String> {
    let bytes = jpeg_bytes(art)?;
    if ![0, 90, 180, 270].contains(&edits.rotation) {
        return Err("Rotation must be a multiple of 90 degrees".into());
    }
    if !edits.brightness.is_finite()
        || !edits.contrast.is_finite()
        || !(0.1..=3.0).contains(&edits.brightness)
        || !(0.1..=3.0).contains(&edits.contrast)
    {
        return Err("Brightness and contrast must be between 0.1 and 3".into());
    }
    let mut image = decode(&bytes)?;
    // Crop coordinates refer to the original, unrotated image, matching Pigeon's editor.
    if let Some(c) = &edits.crop {
        if c.width < 2
            || c.height < 2
            || c.x.checked_add(c.width).is_none_or(|x| x > image.width())
            || c.y.checked_add(c.height).is_none_or(|y| y > image.height())
        {
            return Err(
                "Crop must fit inside the original image and be at least 2 by 2 pixels".into(),
            );
        }
        image = image.crop_imm(c.x, c.y, c.width, c.height);
    }
    image = match edits.rotation {
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => image,
    };
    if edits.flip {
        image = image.fliph();
    }
    let mut pixels = image.to_rgb8();
    for p in pixels.pixels_mut() {
        let mut channels = [f32::from(p[0]), f32::from(p[1]), f32::from(p[2])];
        if edits.grayscale {
            let v = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            channels = [v; 3];
        }
        if edits.negative {
            channels = channels.map(|v| 255.0 - v);
        }
        if edits.sepia {
            let [r, g, b] = channels;
            channels = [
                r * 0.393 + g * 0.769 + b * 0.189,
                r * 0.349 + g * 0.686 + b * 0.168,
                r * 0.272 + g * 0.534 + b * 0.131,
            ];
        }
        *p = Rgb(channels.map(|v| {
            ((v.clamp(0.0, 255.0) * edits.brightness - 128.0) * edits.contrast + 128.0)
                .round()
                .clamp(0.0, 255.0) as u8
        }));
    }
    image = DynamicImage::ImageRgb8(pixels);
    if let Some(r) = &edits.resize {
        dimensions(r.width, r.height)?;
        if r.width > 4096 || r.height > 4096 {
            return Err("Resize is limited to 4096 pixels per edge".into());
        }
        image = image.resize_exact(r.width, r.height, FilterType::Lanczos3);
    }
    encode(image, art.source_label.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Artwork {
        let im = DynamicImage::ImageRgb8(RgbImage::from_pixel(80, 120, Rgb([200, 90, 30])));
        encode(im, "fixture".into()).unwrap()
    }
    #[test]
    fn ratio_crop_is_exact_without_stretching_and_keeps_source_immutable() {
        let original = sample();
        let before = original.jpeg.clone();
        for (w, h) in [(4, 3), (16, 9), (1, 1), (2, 3), (9, 16)] {
            let cropped = crop_to_ratio(&original, w, h).unwrap();
            assert_eq!(cropped.width * h, cropped.height * w);
            assert!(cropped.width <= original.width && cropped.height <= original.height);
            assert!(!jpeg_bytes(&cropped).unwrap().is_empty());
        }
        assert_eq!(original.jpeg, before);
        let wide = encode(
            DynamicImage::ImageRgb8(RgbImage::from_pixel(140, 60, Rgb([20, 90, 100]))),
            "wide".into(),
        )
        .unwrap();
        assert_eq!(crop_to_ratio(&wide, 21, 9).unwrap().jpeg, wide.jpeg);
        assert!(crop_to_ratio(&original, 0, 3).is_err());
    }
    #[test]
    fn crop_then_rotate_then_resize_changes_real_pixels() {
        let a = sample();
        let e = ImageEdits {
            crop: Some(Crop {
                x: 10,
                y: 20,
                width: 40,
                height: 60,
            }),
            rotation: 90,
            resize: Some(Resize {
                width: 30,
                height: 20,
            }),
            grayscale: true,
            ..Default::default()
        };
        let out = edit(&a, &e).unwrap();
        assert_eq!((out.width, out.height), (30, 20));
        let im = decode(&jpeg_bytes(&out).unwrap()).unwrap().to_rgb8();
        let p = im.get_pixel(10, 10);
        assert!((i16::from(p[0]) - i16::from(p[1])).abs() <= 2);
        assert_ne!(a.jpeg, out.jpeg);
    }
    #[test]
    fn invalid_crop_and_extreme_resize_are_rejected() {
        let a = sample();
        assert!(edit(
            &a,
            &ImageEdits {
                crop: Some(Crop {
                    x: u32::MAX,
                    y: 0,
                    width: 40,
                    height: 40
                }),
                ..Default::default()
            }
        )
        .is_err());
        assert!(edit(
            &a,
            &ImageEdits {
                resize: Some(Resize {
                    width: 8192,
                    height: 8192
                }),
                ..Default::default()
            }
        )
        .is_err());
    }
    #[test]
    fn mismatched_or_invalid_project_payload_is_rejected() {
        let mut a = sample();
        a.width = 1;
        assert!(jpeg_bytes(&a).is_err());
        a.jpeg = "not base64".into();
        assert!(jpeg_bytes(&a).is_err());
        assert!(prepare(b"<html>not an image</html>", "invalid").is_err());
    }
    #[test]
    fn tonal_adjustments_change_approved_pixels() {
        let cases = [
            (
                ImageEdits {
                    negative: true,
                    ..Default::default()
                },
                [55, 165, 225],
            ),
            (
                ImageEdits {
                    sepia: true,
                    ..Default::default()
                },
                [153, 137, 107],
            ),
            (
                ImageEdits {
                    brightness: 1.5,
                    ..Default::default()
                },
                [255, 135, 45],
            ),
            (
                ImageEdits {
                    contrast: 2.0,
                    ..Default::default()
                },
                [255, 52, 0],
            ),
        ];
        for (edits, expected) in cases {
            let art = edit(&sample(), &edits).unwrap();
            let image = decode(&jpeg_bytes(&art).unwrap()).unwrap().to_rgb8();
            let pixel = image.get_pixel(20, 20);
            for i in 0..3 {
                assert!((i16::from(pixel[i]) - expected[i]).abs() < 8);
            }
        }
    }
    #[test]
    fn alpha_is_flattened_to_white() {
        let im = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            4,
            4,
            image::Rgba([0, 0, 0, 0]),
        ));
        let a = encode(im, "".into()).unwrap();
        let im = decode(&jpeg_bytes(&a).unwrap()).unwrap();
        assert!(im.to_rgb8().get_pixel(0, 0)[0] > 250);
    }
}
