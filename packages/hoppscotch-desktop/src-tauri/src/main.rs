// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

use std::env;
use reqwest::{Client, cookie::Cookie};
use std::default::Default;

#[derive(serde::Serialize, Default)]
struct TokenResponse {
  access_token: String,
  refresh_token: String,
}

#[tauri::command]
async fn auth_verify(token: String, device_identifier: String, vite_backend_api_url: String) -> Result<TokenResponse, String>  {
    let payload = serde_json::json!({
        "token": token,
        "deviceIdentifier": device_identifier,
    });

    let client = Client::new();
    let response = client.post(&vite_backend_api_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await;

    let response = match response {
        Err(_) => {
            return Err("Failed to retrieve tokens".into());
        },
        Ok(response) => response,
    };

    let mut verify_response = TokenResponse::default();
    if response.status().is_success() {
        let cookies: Vec<Cookie> = response.cookies().collect();
        for cookie in cookies {
            match cookie.name() {
                "access_token" => {
                    verify_response.access_token = cookie.value().to_owned();
                },
                "refresh_token" => {
                    verify_response.refresh_token = cookie.value().to_owned();
                },
                _ => (),
            }
        }
    } else {
        return Err("Failed to retrieve tokens".into());
    }

    Ok(verify_response)
}

#[tauri::command]
async fn auth_refresh(refresh_token: String, vite_backend_api_url: String) -> Result<TokenResponse, String>  {
    let client = Client::new();
    let response = client.post(&vite_backend_api_url)
        .header("Content-Type", "application/json")
        .header("Cookie", format!("refresh_token={}", refresh_token))
        .send()
        .await;

    let response = match response {
        Err(_) => {
            return Err("Failed to retrieve tokens".into());
        },
        Ok(response) => response,
    };

    let mut verify_response = TokenResponse::default();
    if response.status().is_success() {
        let cookies: Vec<Cookie> = response.cookies().collect();
        for cookie in cookies {
            match cookie.name() {
                "access_token" => {
                    verify_response.access_token = cookie.value().to_owned();
                },
                "refresh_token" => {
                    verify_response.refresh_token = cookie.value().to_owned();
                },
                _ => (),
            }
        }
    } else {
        return Err("Failed to retrieve tokens".into());
    }

    Ok(verify_response)
}

fn main() {
    tauri_plugin_deep_link::prepare("io.hoppscotch.desktop");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![auth_verify, auth_refresh])
        .setup(|app| {
            let handle = app.handle();
            tauri_plugin_deep_link::register(
                "hoppscotch",
                move |request| {
                    println!("{:?}", request);
                    handle.emit_all("scheme-request-received", request).unwrap();
                },
            ).unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
