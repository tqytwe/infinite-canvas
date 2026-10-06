package main

import (
	"context"
	"encoding/json"
	"testing"
)

func TestWorkflowFieldsKeepOriginalBridgeExecution(t *testing.T) {
	var request bridgeRequest
	if err := json.Unmarshal([]byte(`{"payload": {
		"mode": "image",
		"workflowJson": {
			"1": {"class_type": "LoadImage", "inputs": {"image": "old.png"}},
			"2": {"class_type": "KSampler", "inputs": {"image": ["1", 0], "steps": 20}},
			"3": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}}
		},
		"workflowFields": [
			{"nodeId": "1", "fieldName": "image", "source": "referenceImage", "sourceIndex": 0, "enabled": true},
			{"nodeId": "2", "fieldName": "steps", "source": "count", "enabled": true},
			{"nodeId": "3", "fieldName": "text", "source": "prompt", "enabled": true}
		],
		"referenceImages": [],
		"workflowOverrides": [
			{"nodeId": "2", "fieldName": "steps", "value": 5},
			{"nodeId": "3", "fieldName": "text", "value": "updated"}
		]
	}}`), &request); err != nil {
		t.Fatal(err)
	}
	// The service resolves business sources and user field values before queueing overrides.
	payload := request.Payload
	workflow, err := loadWorkflow(context.Background(), bridgeOptions{}, payload)
	if err != nil {
		t.Fatal(err)
	}
	fields := sliceValue(payload["workflowFields"])
	if err := validateWorkflowMediaInputs(fields, payload); err != nil {
		t.Fatal(err)
	}
	if err := applyWorkflowFields(workflow, payload, map[string]string{}); err != nil {
		t.Fatal(err)
	}
	if _, exists := workflow["1"]; exists {
		t.Fatal("缺失的可选素材节点未删除")
	}
	node, _ := mapValue(workflow["2"])
	inputs, _ := mapValue(node["inputs"])
	if _, exists := inputs["image"]; exists {
		t.Fatal("已删除素材节点的连接未清理")
	}
	if inputs["steps"] != float64(5) {
		t.Fatalf("工作流业务字段未传入：%#v", workflow)
	}
	node, _ = mapValue(workflow["3"])
	inputs, _ = mapValue(node["inputs"])
	if inputs["text"] != "updated" {
		t.Fatalf("prompt override was not applied: %#v", workflow)
	}
}

func TestWorkflowOverridesPreserveOriginalValues(t *testing.T) {
	var payload jsonMap
	if err := json.Unmarshal([]byte(`{
		"workflowJson": {"2": {"class_type": "KSampler", "inputs": {
			"steps": 20, "seed": 123, "enabled": true, "sampler_name": "euler"
		}}},
		"workflowFields": [
			{"nodeId": "2", "fieldName": "steps", "source": "count"},
			{"nodeId": "2", "fieldName": "seed"},
			{"nodeId": "2", "fieldName": "enabled"},
			{"nodeId": "2", "fieldName": "sampler_name", "enabled": false}
		],
		"workflowOverrides": [
			{"nodeId": "2", "fieldName": "seed", "value": 0},
			{"nodeId": "2", "fieldName": "enabled", "value": false},
			{"nodeId": "2", "fieldName": "sampler_name", "value": "changed"}
		]
	}`), &payload); err != nil {
		t.Fatal(err)
	}
	workflow, err := loadWorkflow(context.Background(), bridgeOptions{}, payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyWorkflowFields(workflow, payload, nil); err != nil {
		t.Fatal(err)
	}
	node, _ := mapValue(workflow["2"])
	inputs, _ := mapValue(node["inputs"])
	if inputs["steps"] != float64(20) || inputs["seed"] != float64(0) || inputs["enabled"] != false || inputs["sampler_name"] != "euler" {
		t.Fatalf("original values or explicit overrides changed: %#v", inputs)
	}
}

func TestWorkflowMediaOverrideUsesUploadedFile(t *testing.T) {
	for _, uploaded := range []bool{true, false} {
		t.Run(map[bool]string{true: "uploaded", false: "missing"}[uploaded], func(t *testing.T) {
			var payload jsonMap
			if err := json.Unmarshal([]byte(`{
				"workflowJson": {"1": {"class_type": "LoadImage", "inputs": {"image": "old.png"}}},
				"workflowFields": [{"nodeId": "1", "fieldName": "image", "source": "referenceImage", "required": true}],
				"referenceImages": [{"id": "image:0"}],
				"workflowOverrides": [{"nodeId": "1", "fieldName": "image", "value": {"mediaId": "image:0"}}]
			}`), &payload); err != nil {
				t.Fatal(err)
			}
			workflow, err := loadWorkflow(context.Background(), bridgeOptions{}, payload)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateWorkflowMediaInputs(sliceValue(payload["workflowFields"]), payload); err != nil {
				t.Fatal(err)
			}
			files := map[string]string{}
			if uploaded {
				files["image:0"] = "uploaded.png"
			}
			err = applyWorkflowFields(workflow, payload, files)
			if !uploaded {
				if err == nil {
					t.Fatal("missing upload result was accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			node, _ := mapValue(workflow["1"])
			inputs, _ := mapValue(node["inputs"])
			if inputs["image"] != "uploaded.png" {
				t.Fatalf("media override was not applied: %#v", workflow)
			}
		})
	}
}
