#!/usr/bin/env python3
"""
Create a tiny 2-layer MLP ONNX model for inference spike testing.
Architecture: input(4) -> Linear(4, 8) -> ReLU -> Linear(8, 2) -> output(2)
"""

import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

def create_tiny_mlp():
    input_name = 'input'
    output_name = 'output'
    
    hidden_size = 8
    input_size = 4
    output_size = 2
    
    np.random.seed(42)
    
    W1 = np.random.randn(hidden_size, input_size).astype(np.float32) * 0.1
    b1 = np.random.randn(hidden_size).astype(np.float32) * 0.1
    W2 = np.random.randn(output_size, hidden_size).astype(np.float32) * 0.1
    b2 = np.random.randn(output_size).astype(np.float32) * 0.1
    
    input_tensor = helper.make_tensor_value_info(input_name, TensorProto.FLOAT, [1, input_size])
    output_tensor = helper.make_tensor_value_info(output_name, TensorProto.FLOAT, [1, output_size])
    
    W1_init = numpy_helper.from_array(W1, name='W1')
    b1_init = numpy_helper.from_array(b1, name='b1')
    W2_init = numpy_helper.from_array(W2, name='W2')
    b2_init = numpy_helper.from_array(b2, name='b2')
    
    nodes = [
        helper.make_node('Gemm', [input_name, 'W1', 'b1'], ['gemm1'], name='gemm1', alpha=1.0, beta=1.0, transB=1),
        helper.make_node('Relu', ['gemm1'], ['relu1'], name='relu1'),
        helper.make_node('Gemm', ['relu1', 'W2', 'b2'], [output_name], name='gemm2', alpha=1.0, beta=1.0, transB=1),
    ]
    
    graph = helper.make_graph(
        nodes,
        'tiny_mlp',
        [input_tensor],
        [output_tensor],
        initializer=[W1_init, b1_init, W2_init, b2_init]
    )
    
    model = helper.make_model(graph, producer_name='glasswall-spike', opset_imports=[helper.make_opsetid('', 17)])
    onnx.checker.check_model(model)
    
    output_path = 'mlp-tiny.onnx'
    onnx.save(model, output_path)
    print(f'Model saved to {output_path}')
    
    import onnxruntime as ort
    session = ort.InferenceSession(output_path)
    test_input = np.random.randn(1, 4).astype(np.float32)
    result = session.run(None, {'input': test_input})
    print(f'Test input shape: {test_input.shape}')
    print(f'Test output shape: {result[0].shape}')
    print(f'Test output: {result[0]}')
    
    return output_path

if __name__ == '__main__':
    create_tiny_mlp()